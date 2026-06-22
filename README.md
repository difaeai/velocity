# ShareRide Pakistan 🚗🏍️

An AI-powered ride-hailing and smart ride-sharing (pooling) platform for Pakistan, designed to reduce transportation costs through gender-based route pooling and custom bidding while retaining traditional private rides.

## 🌟 Key Features

- **Passenger Mobile App Experience**: Complete flow from ride selection (Bikes, Rickshaws, Mini, AC Cars, Comfort, XL), real-time seat selection & fare splitting, gender-based ride pooling toggles, bidding system, safety features (SOS, route deviation warnings), and interactive wallet.
- **Driver Mobile App Experience**: Real-time incoming bidding requests, route details, and income ledger.
- **Super Admin Dashboard**: Full fleet overview, driver registrations/approvals, active trip tracking, transaction logs, promo management, and real-time safety alerts.
- **Operations Dashboard**: Hub-based smart pooling management, real-time fleet map, system KPIs, and live AI matchmaking console.
- **Real-Time Firebase Synchronization**: Sync stats, bids, navigation states, logs, and alerts across different browser tabs/devices in real-time.

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript, Vanilla CSS, Tailwind CSS (via CDN)
- **Database**: Cloud Firestore (Real-time sync)
- **Icons**: FontAwesome & Lucide Icons
- **Mapping**: Dynamic vector-based canvas map simulation

---

## 🔥 Firebase Setup Instructions

The application contains a built-in real-time synchronization layer powered by **Firebase Firestore**. It features a graceful fallback so that if no Firebase config is present, the app will run in **local/offline mode** (everything runs in-memory).

To enable real-time multi-device sync:
1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Add Project**.
2. Create a web application in the project to obtain your configuration object:
   ```javascript
   const firebaseConfig = {
       apiKey: "...",
       authDomain: "...",
       projectId: "...",
       storageBucket: "...",
       messagingSenderId: "...",
       appId: "..."
   };
   ```
3. Open **`app.js`** and locate the `firebaseConfig` object at the top. Paste your configuration credentials inside it.
4. Go to the Firestore Database section in Firebase, click **Create Database**, and select **Start in test mode** (or set database security rules to allow read/write access).
5. Open **`index.html`** in multiple different browser windows, or on different devices, and see the states (bidding, active map, SOS, verification statuses) sync instantly in real-time!

---

## 💻 How to Run Locally

Start a local server in the project directory:
```bash
npx -y http-server d:\Velocity -p 8080
```
Then visit **[http://127.0.0.1:8080](http://127.0.0.1:8080)**.
