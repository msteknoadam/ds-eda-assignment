import type { DynamoDBStreamHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
	throw new Error(
		"Please add the SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION environment variables in an env.js file located in the root directory"
	);
}

type ContactDetails = {
	name: string;
	email: string;
	message: string;
};

const client = new SESClient({ region: SES_REGION });

export const handler: DynamoDBStreamHandler = async (event) => {
	console.log("Event ", JSON.stringify(event));
	for (const record of event.Records) {
		const deletedImageName = record.dynamodb?.OldImage?.imageName?.S;

		if (deletedImageName) {
			try {
				const { name, email, message }: ContactDetails = {
					name: "The Photo Album",
					email: SES_EMAIL_FROM,
					message: `Your image with name '${deletedImageName}' has been deleted. We hope you enjoyed our service!`,
				};
				const params = sendEmailParams({ name, email, message });
				await client.send(new SendEmailCommand(params));
			} catch (error: unknown) {
				console.log("Error while sending deletion mail is: ", error);
				// return;
			}
		}
	}
};

function sendEmailParams({ name, email, message }: ContactDetails) {
	const parameters: SendEmailCommandInput = {
		Destination: {
			ToAddresses: [SES_EMAIL_TO],
		},
		Message: {
			Body: {
				Html: {
					Charset: "UTF-8",
					Data: getHtmlContent({ name, email, message }),
				},
				// Text: {.           // For demo purposes
				//   Charset: "UTF-8",
				//   Data: getTextContent({ name, email, message }),
				// },
			},
			Subject: {
				Charset: "UTF-8",
				Data: `Image Deleted`,
			},
		},
		Source: SES_EMAIL_FROM,
	};
	return parameters;
}

function getHtmlContent({ name, email, message }: ContactDetails) {
	return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}

// For demo purposes - not used here.
function getTextContent({ name, email, message }: ContactDetails) {
	return `
    Received an Email. 📬
    Sent from:
        👤 ${name}
        ✉️ ${email}
    ${message}
  `;
}
