# Bible Verse Extension Server

Small server-side API for sending a selected Bible verse through Twilio.

## Security model

POST /send-verse is deliberately **not public**. It requires all of the following:

- a server-verified Authorization: Bearer <VERSE_API_KEY> header
- an allowed browser origin from ALLOWED_ORIGINS
- an E.164 recipient listed in ALLOWED_RECIPIENTS
- valid JSON with a verse no longer than 600 characters
- per-IP, per-recipient, and daily server-side rate limits

The former /verify and /check-verification routes were removed because a client supplied identifier is not proof of identity.

CORS is an additional browser control, not authentication. The bearer token and recipient allowlist are enforced by the server.

## Setup

1. Copy .env.example to a local .env.
2. Set each real value in your hosting provider's environment settings. Do not upload or commit .env.
3. Generate a random VERSE_API_KEY of at least 32 characters.
4. Set ALLOWED_ORIGINS to the exact extension origin, for example chrome-extension://your-extension-id.
5. Set ALLOWED_RECIPIENTS to only the phone numbers that are permitted to receive messages.
6. Deploy with Node 18 or later.

Required environment variables:

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
- VERSE_API_KEY
- ALLOWED_ORIGINS
- ALLOWED_RECIPIENTS

Optional rate-limit configuration appears in .env.example.

## Client request

An authorized client sends:

~~~
POST /send-verse
Authorization: Bearer <VERSE_API_KEY>
Content-Type: application/json

{
  "verse": "John 3:16 ...",
  "phoneNumber": "+15551234567"
}
~~~

A normal accepted request returns 202 with { "success": true }. Unauthorized, malformed, disallowed-recipient, and rate-limited requests are rejected without calling Twilio.

## Important distribution note

A long-lived shared API key is suitable only for a private, controlled client. Do **not** embed it in a public or broadly distributed browser extension, because extension users can extract client-side values. Before public distribution or multi-user use, replace the static client credential with a real identity provider and server-verified user tokens.

## Local development

~~~bash
npm ci
npm test
npm start
~~~

Use only test or development credentials locally. Production Twilio credentials remain server-side in the hosting provider.
