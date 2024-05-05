import { SQSHandler } from "aws-lambda";
import { sendEmail } from "/opt/mailUtils";

export const handler: SQSHandler = async (event: any) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const snsBody = record.Sns;
		const snsMessage = JSON.parse(snsBody.Message);

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
							message: `We received your Image. Its URL is s3://${srcBucket}/${srcKey}`,
						},
						"New Image Upload"
					);
				} catch (error: unknown) {
					console.error("Error while sending confirmation mail is: ", error);
				}
			}
		}
	}
};
