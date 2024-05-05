import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ALLOWED_FILE_EXTENSIONS } from "shared/constants";

const ddbDocClient = createDDbDocClient();

export const handler: SQSHandler = async (event) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const recordBody = JSON.parse(record.body); // Parse SQS message
		const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

		if (snsMessage.Records) {
			console.log("Record body ", JSON.stringify(snsMessage));
			for (const messageRecord of snsMessage.Records) {
				const s3e = messageRecord.s3;
				// Object key may have spaces or unicode non-ASCII characters.
				const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

				const fileExtension = srcKey.split(".").pop() || "";
				if (!ALLOWED_FILE_EXTENSIONS.includes(fileExtension)) {
					throw new Error(`File extension ${fileExtension} is not supported.`);
				}

				try {
					// Process the image
					const commandOutput = await ddbDocClient.send(
						new PutCommand({
							TableName: process.env.TABLE_NAME,
							Item: { imageName: srcKey },
						})
					);
				} catch (error) {
					console.log(error);
				}
			}
		}
	}
};

function createDDbDocClient() {
	const ddbClient = new DynamoDBClient({ region: process.env.REGION });
	const marshallOptions = {
		convertEmptyValues: true,
		removeUndefinedValues: true,
		convertClassInstanceToMap: true,
	};
	const unmarshallOptions = {
		wrapNumbers: false,
	};
	const translateConfig = { marshallOptions, unmarshallOptions };
	return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}
