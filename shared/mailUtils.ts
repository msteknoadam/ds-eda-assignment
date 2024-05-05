import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { ContactDetails } from "./types";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
	throw new Error(
		"Please add the SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION environment variables in an env.js file located in the root directory"
	);
}

const client = new SESClient({ region: SES_REGION });

export async function sendEmail({ name, message }: Pick<ContactDetails, "name" | "message">, subject: string) {
	const params: SendEmailCommandInput = {
		Destination: {
			ToAddresses: [SES_EMAIL_TO],
		},
		Message: {
			Body: {
				Html: {
					Charset: "UTF-8",
					Data: getHtmlContent({ name, email: SES_EMAIL_FROM, message }),
				},
			},
			Subject: {
				Charset: "UTF-8",
				Data: subject,
			},
		},
		Source: SES_EMAIL_FROM,
	};

	await client.send(new SendEmailCommand(params));
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
