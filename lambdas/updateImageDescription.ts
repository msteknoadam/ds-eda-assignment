import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SQSHandler = async (event: any) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const snsBody = record.Sns;
		const snsMessage = JSON.parse(snsBody.Message);

		console.log("Message body ", JSON.stringify(snsMessage));
		// Sent image name might have spaces
		const imageName = snsMessage.name.trim();

		const foundImageRow = await ddbDocClient.send(
			new GetCommand({
				TableName: process.env.TABLE_NAME,
				Key: { imageName },
			})
		);

		if (!foundImageRow.Item) {
			throw new Error(`Image ${imageName} not found in the database`);
		}

		try {
			// Update the image description
			const commandOutput = await ddbDocClient.send(
				new UpdateCommand({
					TableName: process.env.TABLE_NAME,
					Key: { imageName },
					UpdateExpression: "set description = :description",
					ExpressionAttributeValues: {
						":description": snsMessage.description,
					},
				})
			);
		} catch (error) {
			console.log(error);
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
