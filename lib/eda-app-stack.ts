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
// import * as sqs from 'aws-cdk-lib/aws-sqs';

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

		// Topic Subscriptions
		const newImageTopic = new sns.Topic(this, "NewImageTopic", {
			displayName: "New Image topic",
		});

		newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));
		newImageTopic.addSubscription(new subs.LambdaSubscription(confirmationMailerFn));

		// S3 --> SQS
		imagesBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SnsDestination(newImageTopic));

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

		// Output
		new cdk.CfnOutput(this, "bucketName", {
			value: imagesBucket.bucketName,
		});
	}
}
