import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";

export class EDAAppStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Buckets
		const imagesBucket = new s3.Bucket(this, "images", {
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			publicReadAccess: false,
		});

		// Tables
		const imagesTable = new dynamodb.Table(this, "ImagesTable", {
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			partitionKey: { name: "imageName", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tableName: "Images",
			stream: StreamViewType.OLD_IMAGE,
		});

		// Integration infrastructure
		const failedImagesQueue = new sqs.Queue(this, "failed-images-queue", {
			retentionPeriod: cdk.Duration.minutes(30),
		});

		const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
			receiveMessageWaitTime: cdk.Duration.seconds(10),
			deadLetterQueue: {
				queue: failedImagesQueue,
				// # of rejections by consumer (lambda function)
				maxReceiveCount: 1,
			},
		});

		// Lambda functions
		const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
			runtime: lambda.Runtime.NODEJS_18_X,
			entry: `${__dirname}/../lambdas/processImage.ts`,
			timeout: cdk.Duration.seconds(15),
			memorySize: 128,
			environment: {
				TABLE_NAME: imagesTable.tableName,
				REGION: "eu-west-1",
			},
		});

		const removeImageFn = new lambdanode.NodejsFunction(this, "RemoveImageFn", {
			runtime: lambda.Runtime.NODEJS_16_X,
			entry: `${__dirname}/../lambdas/removeImage.ts`,
			timeout: cdk.Duration.seconds(15),
			memorySize: 128,
			environment: {
				TABLE_NAME: imagesTable.tableName,
				REGION: "eu-west-1",
			},
		});

		const updateImageDescriptionFn = new lambdanode.NodejsFunction(this, "UpdateImageDescriptionFn", {
			runtime: lambda.Runtime.NODEJS_16_X,
			entry: `${__dirname}/../lambdas/updateImageDescription.ts`,
			timeout: cdk.Duration.seconds(15),
			memorySize: 128,
			environment: {
				TABLE_NAME: imagesTable.tableName,
				REGION: "eu-west-1",
			},
		});

		const confirmationMailerFn = new lambdanode.NodejsFunction(this, "ConfirmationMailerFn", {
			runtime: lambda.Runtime.NODEJS_16_X,
			memorySize: 1024,
			timeout: cdk.Duration.seconds(3),
			entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
		});

		const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
			architecture: lambda.Architecture.ARM_64,
			runtime: lambda.Runtime.NODEJS_16_X,
			entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
			timeout: cdk.Duration.seconds(10),
			memorySize: 128,
		});

		const deleteMailerFn = new lambdanode.NodejsFunction(this, "DeleteMailerFn", {
			runtime: lambda.Runtime.NODEJS_16_X,
			entry: `${__dirname}/../lambdas/deleteMailer.ts`,
			timeout: cdk.Duration.seconds(15),
			memorySize: 128,
		});

		// Topic Subscriptions
		const imageTopic = new sns.Topic(this, "ImageTopic", {
			displayName: "Image Updates Topic (create/update/delete)",
		});

		// New image event
		imageTopic.addSubscription(
			new subs.SqsSubscription(imageProcessQueue, {
				filterPolicyWithMessageBody: {
					Records: sns.FilterOrPolicy.filter(
						new sns.SubscriptionFilter(
							{
								eventName: [
									{
										prefix: "ObjectCreated:",
									},
								],
							} as any /** set as any because currently it's not supported by the aws-cdk-lib to filter by message payload's attributes */
						)
					),
				},
			})
		);
		// New image event
		imageTopic.addSubscription(
			new subs.LambdaSubscription(confirmationMailerFn, {
				filterPolicyWithMessageBody: {
					Records: sns.FilterOrPolicy.filter(
						new sns.SubscriptionFilter(
							{
								eventName: [
									{
										prefix: "ObjectCreated:",
									},
								],
							} as any /** set as any because currently it's not supported by the aws-cdk-lib to filter by message payload's attributes */
						)
					),
				},
			})
		);
		// Removed image event
		imageTopic.addSubscription(
			new subs.LambdaSubscription(removeImageFn, {
				filterPolicyWithMessageBody: {
					Records: sns.FilterOrPolicy.filter(
						new sns.SubscriptionFilter(
							{
								eventName: [
									{
										prefix: "ObjectRemoved:",
									},
								],
							} as any /** set as any because currently it's not supported by the aws-cdk-lib to filter by message payload's attributes */
						)
					),
				},
			})
		);
		// Updated image event
		imageTopic.addSubscription(
			new subs.LambdaSubscription(updateImageDescriptionFn, {
				filterPolicy: {
					comment_type: sns.SubscriptionFilter.stringFilter({
						allowlist: ["Caption"],
					}),
				},
			})
		);

		// DynamoDB --> Lambda
		deleteMailerFn.addEventSource(
			new DynamoEventSource(imagesTable, {
				startingPosition: StartingPosition.TRIM_HORIZON,
				batchSize: 1,
				bisectBatchOnError: true,
				retryAttempts: 2,
			})
		);

		// S3 --> SQS
		imagesBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SnsDestination(imageTopic));
		imagesBucket.addEventNotification(s3.EventType.OBJECT_REMOVED, new s3n.SnsDestination(imageTopic));

		// SQS --> Lambda
		const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
			batchSize: 5,
			maxBatchingWindow: cdk.Duration.seconds(10),
		});

		processImageFn.addEventSource(newImageEventSource);

		rejectionMailerFn.addEventSource(
			new SqsEventSource(failedImagesQueue, {
				maxBatchingWindow: cdk.Duration.seconds(5),
				maxConcurrency: 2,
			})
		);

		// Permissions
		imagesBucket.grantRead(processImageFn);
		imagesTable.grantReadWriteData(processImageFn);
		imagesTable.grantReadWriteData(removeImageFn);
		imagesTable.grantReadWriteData(updateImageDescriptionFn);

		confirmationMailerFn.addToRolePolicy(
			new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
				resources: ["*"],
			})
		);

		rejectionMailerFn.addToRolePolicy(
			new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
				resources: ["*"],
			})
		);

		deleteMailerFn.addToRolePolicy(
			new iam.PolicyStatement({
				effect: iam.Effect.ALLOW,
				actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
				resources: ["*"],
			})
		);

		// Output
		new cdk.CfnOutput(this, "bucketName", {
			value: imagesBucket.bucketName,
		});
		new cdk.CfnOutput(this, "imageTopicARN", {
			value: imageTopic.topicArn,
		});
	}
}
