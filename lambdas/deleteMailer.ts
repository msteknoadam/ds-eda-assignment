import type { DynamoDBStreamHandler } from "aws-lambda";
import { sendEmail } from "/opt/mailUtils";

export const handler: DynamoDBStreamHandler = async (event) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		if (record.eventName !== "REMOVE") {
			continue;
		}

		const deletedImageName = record.dynamodb?.OldImage?.imageName?.S;

		if (deletedImageName) {
			try {
				await sendEmail(
					{
						name: "The Photo Album",
						message: `Your image with name '${deletedImageName}' has been deleted. We hope you enjoyed our service!`,
					},
					"Image Deleted"
				);
			} catch (error: unknown) {
				console.error("Error while sending deletion mail is: ", error);
			}
		}
	}
};
