# AirWatch

AirWatch is a React + JavaScript AQI dashboard that:

- lets you search and add live AQI stations or cities with clear colour grading
- tracks the user&apos;s location in the browser
- sends an SMS through Twilio when the device moves into worse air
- lets you send a test SMS from the settings panel

## Stack

- React + Vite for the UI
- Native Node.js server for AQI proxying and SMS delivery
- WAQI API for live air-quality data
- Twilio Messaging API for SMS alerts

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values:

   ```env
   SERVER_PORT=8787
   WAQI_API_TOKEN=your_waqi_token
   CITY_LIST=
   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_FROM_NUMBER=your_twilio_number
   DEFAULT_ALERT_PHONE=+15551234567
   ```

3. Start both frontend and backend together:

   ```bash
   npm run dev
   ```

4. `npm run dev:all` also works and does the same thing.

5. If you prefer separate terminals, start the backend first:

   ```bash
   npm run server
   ```

6. In another terminal, start the React frontend:

   ```bash
   npm run dev:client
   ```

7. Open the local Vite URL, search for the cities you want to track, allow browser geolocation, and set your phone number in E.164 format such as `+15551234567`.

If you already have `PORT=5173` in `.env`, either remove it or rename it to `SERVER_PORT=8787` so the API server does not clash with Vite during local development.

## Production build

```bash
npm run build
npm start
```

After `npm run build`, the Node server will serve the compiled React app from `dist/`.

## Notes

- WAQI requires your own token for accurate live city readings. Their public `demo` token can return sample station data instead of the city you request, so the example file leaves the token blank on purpose.
- SMS alerts only work after Twilio credentials are configured on the server.
- The UI includes a `Send test SMS` button so you can verify Twilio setup before using live location alerts.
- The app treats a "higher AQI" arrival as entering a worse AQI band, crossing the chosen threshold, or jumping sharply based on your alert rules.
- WAQI attribution is required by the data provider.
