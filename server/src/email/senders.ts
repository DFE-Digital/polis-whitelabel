import AWS from "aws-sdk";
import nodemailer from "nodemailer";
import mg from "nodemailer-mailgun-transport";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import SESTransport from "nodemailer/lib/ses-transport";
import { parseIntOrFallback } from "../utils/env";

// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-region.html
// v2 docs, since we use v2 in our package.json: "aws:sdk": "2.78.0"
AWS.config.update({ region: process.env.AWS_REGION });

function sendTextEmailWithBackup(
  sender: any,
  recipient: any,
  subject: any,
  text: any
) {
  if (!process.env.EMAIL_TRANSPORT_TYPES) {
    return
  }
  const transportTypes = process.env.EMAIL_TRANSPORT_TYPES
    ? process.env.EMAIL_TRANSPORT_TYPES.split(",")
    : ["aws-ses", "mailgun"];
  if (transportTypes.length < 2) {
    new Error("No backup email transport available.");
  }
  const backupTransport = transportTypes[1];
  sendTextEmail(sender, recipient, subject, text, backupTransport);
}

function getMailOptions(transportType: string | undefined): SMTPTransport.Options | SESTransport.Options | SMTPTransport {
  switch (transportType) {
    case "maildev":
      return {
        host: process.env.MAILDEV_HOST,
        port: parseIntOrFallback(process.env.MAILDEV_SMTP_PORT, undefined),
        ignoreTLS: true,
      };
    case "mailgun":
      return mg({
        auth: {
          // This forces fake credentials if envvars unset, so error is caught
          // in auth and failover works without crashing server process.
          // TODO: Suppress error thrown by mailgun library when unset.
          api_key: process.env.MAILGUN_API_KEY || "unset-value",
          domain: process.env.MAILGUN_DOMAIN || "unset-value",
        },
      });
    case "aws-ses":
      return {
        // reads AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from process.env
        // reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from process.env
        SES: new AWS.SES({ apiVersion: "2010-12-01" }),
      };
    default:
      return {};
  }
}

function sendTextEmail(
  sender: string | undefined,
  recipient: string | undefined,
  subject: string | undefined,
  text: string | undefined,
  transportTypes = process.env.EMAIL_TRANSPORT_TYPES,
  priority = 1
): Promise<SMTPTransport.SentMessageInfo | undefined>  {
  // Exit if empty string passed.
  if (!transportTypes) {
    return Promise.resolve(undefined)
  }

  const transportTypesArray = transportTypes.split(",");
  // Shift first index and clone to rename.
  const thisTransportType = transportTypesArray.shift();
  const nextTransportTypes = [...transportTypesArray];
  const mailOptions = getMailOptions(thisTransportType);
  const transporter = nodemailer.createTransport(mailOptions);

  return transporter
    .sendMail({ from: sender, to: recipient, subject: subject, text: text })
    .catch(function (err: any) {
      console.error(
        "polis_err_email_sender_failed_transport_priority_" +
          priority.toString()
      );
      console.error(
        `Unable to send email via priority ${priority.toString()} transport '${thisTransportType || '<NOT SPECIFIED>'}' to: ${recipient || '<NOT SPECIFIED>'}`
      );
      console.error(err);
      return sendTextEmail(
        sender,
        recipient,
        subject,
        text,
        nextTransportTypes.join(","),
        priority + 1
      );
    });
}

export {
  sendTextEmail,
  sendTextEmailWithBackup as sendTextEmailWithBackupOnly,
};

export default {
  sendTextEmail: sendTextEmail,
  sendTextEmailWithBackupOnly: sendTextEmailWithBackup,
};
