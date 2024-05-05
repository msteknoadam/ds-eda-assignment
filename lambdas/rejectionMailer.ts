import { SQSHandler } from "aws-lambda";
import { sendEmail } from "/opt/mailUtils";

export const handler: SQSHandler = async (event: any) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const recordBody = JSON.parse(record.body);
		const snsMessage = JSON.parse(recordBody.Message);

		if (snsMessage.Records) {
			console.log("Record body ", JSON.stringify(snsMessage));
			for (const messageRecord of snsMessage.Records) {
				const s3e = messageRecord.s3;
				const srcBucket = s3e.bucket.name;
				// Object key may have spaces or unicode non-ASCII characters.
				const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

				try {
					await sendEmail(
						{
							name: "The Photo Album",
							message: `We were unable to process your image. Failed image URL is s3://${srcBucket}/${srcKey}. Please upload a new image. Images must be in .jpeg or .png format`,
						},
						"Action Needed: Image Processing Failed"
					);
				} catch (error: unknown) {
					console.error("Error while sending rejection mail is: ", error);
				}
			}
		}
	}
};
