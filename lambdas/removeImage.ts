import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ALLOWED_FILE_EXTENSIONS } from "shared/constants";

const ddbDocClient = createDDbDocClient();

export const handler: SQSHandler = async (event: any) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const snsBody = record.Sns;
		const snsMessage = JSON.parse(snsBody.Message);

		if (snsMessage.Records) {
			console.log("Record body ", JSON.stringify(snsMessage));
			for (const messageRecord of snsMessage.Records) {
				const s3e = messageRecord.s3;
				// Object key may have spaces or unicode non-ASCII characters.
				const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

				const fileExtension = srcKey.split(".").pop() || "";
				if (!ALLOWED_FILE_EXTENSIONS.includes(fileExtension)) {
					// No need to try to delete the image if it's not supported, since those won't be in the table anyways
					throw new Error(`File extension ${fileExtension} is not supported.`);
				}

				try {
					// Delete the image
					const commandOutput = await ddbDocClient.send(
						new DeleteCommand({
							TableName: process.env.TABLE_NAME,
							Key: { imageName: srcKey },
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
