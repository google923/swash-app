const FIREBASE_WEB_APP_URL = "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
const FIREBASE_WEB_FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCLmrWYAY4e7tQD9Cknxp7cKkzqJgndm0I",
  authDomain: "swash-app-436a1.firebaseapp.com",
  projectId: "swash-app-436a1",
  storageBucket: "swash-app-436a1.firebasestorage.app",
  messagingSenderId: "724611205173",
  appId: "1:724611205173:web:d17474ad848856d6c3497c",
};
const OUTBOUND_FROM_ADDRESS = "contact@swashcleaning.co.uk";

let clientToolkitPromise = null;
let serverToolkitPromise = null;

function normaliseEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

async function loadClientToolkit() {
  if (!clientToolkitPromise) {
    clientToolkitPromise = (async () => {
      const [{ initializeApp, getApps }, firestoreModule] = await Promise.all([
        import(FIREBASE_WEB_APP_URL),
        import(FIREBASE_WEB_FIRESTORE_URL),
      ]);
      const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
      const db = firestoreModule.getFirestore(app);
      return { db, firestore: firestoreModule };
    })();
  }
  return clientToolkitPromise;
}

async function loadServerToolkit() {
  if (!serverToolkitPromise) {
    serverToolkitPromise = (async () => {
      const adminModule = await import("firebase-admin");
      const admin = adminModule.default || adminModule;
      if (!admin.apps.length) {
        try {
          if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
              credential: admin.credential.cert(credentials),
            });
          } else {
            admin.initializeApp({
              credential: admin.credential.applicationDefault(),
            });
          }
        } catch (error) {
          console.error("[FirestoreUtils] Failed to initialise Firebase Admin", error);
          throw error;
        }
      }
      const db = admin.firestore();
      return { admin, db };
    })();
  }
  return serverToolkitPromise;
}

export async function logOutboundEmailToFirestore({ to, subject = "", body = "", source = "emailjs" }) {
  const recipientRaw = normaliseEmail(to);
  if (!recipientRaw) {
    throw new Error("Recipient email is required");
  }

  const recipient = recipientRaw;
  const emailLower = recipient.toLowerCase();
  const subjectText = typeof subject === "string" ? subject.trim() : "";
  const bodyText = typeof body === "string" ? body : "";
  const preview = bodyText ? bodyText.slice(0, 240) : subjectText.slice(0, 240);

  if (typeof window === "undefined") {
    const { admin, db } = await loadServerToolkit();
    const FieldValue = admin.firestore.FieldValue;
    const customersRef = db.collection("customers");

    let customerRef = null;

    const lowerSnap = await customersRef.where("emailLower", "==", emailLower).limit(1).get();
    if (!lowerSnap.empty) {
      customerRef = lowerSnap.docs[0].ref;
      const data = lowerSnap.docs[0].data() || {};
      if (!data.emailLower) {
        await customerRef.set({ emailLower }, { merge: true });
      }
    } else {
      const directSnap = await customersRef.where("email", "==", recipient).limit(1).get();
      if (!directSnap.empty) {
        customerRef = directSnap.docs[0].ref;
        await customerRef.set({ emailLower }, { merge: true });
      } else {
        customerRef = await customersRef.add({
          email: recipient,
          emailLower,
          name: recipient,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await customerRef.collection("messages").add({
      direction: "outbound",
      type: "email",
      channel: "email",
      source,
      from: OUTBOUND_FROM_ADDRESS,
      to: recipient,
      subject: subjectText,
      body: bodyText,
      preview,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });

    return { customerId: customerRef.id };
  }

  const { db, firestore } = await loadClientToolkit();
  const { collection, addDoc, query, where, getDocs, setDoc, serverTimestamp, limit } = firestore;

  const customersRef = collection(db, "customers");
  let customerId = null;

  const lowerQuery = query(customersRef, where("emailLower", "==", emailLower), limit(1));
  const lowerSnapshot = await getDocs(lowerQuery);
  if (!lowerSnapshot.empty) {
    customerId = lowerSnapshot.docs[0].id;
    const data = lowerSnapshot.docs[0].data() || {};
    if (!data.emailLower) {
      await setDoc(lowerSnapshot.docs[0].ref, { emailLower }, { merge: true });
    }
  } else {
    const directQuery = query(customersRef, where("email", "==", recipient), limit(1));
    const directSnapshot = await getDocs(directQuery);
    if (!directSnapshot.empty) {
      customerId = directSnapshot.docs[0].id;
      await setDoc(directSnapshot.docs[0].ref, { emailLower }, { merge: true });
    } else {
      const newCustomer = await addDoc(customersRef, {
        email: recipient,
        emailLower,
        name: recipient,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      customerId = newCustomer.id;
    }
  }

  const messagesRef = collection(db, `customers/${customerId}/messages`);
  await addDoc(messagesRef, {
    direction: "outbound",
    type: "email",
    channel: "email",
    source,
    from: OUTBOUND_FROM_ADDRESS,
    to: recipient,
    subject: subjectText,
    body: bodyText,
    preview,
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  return { customerId };
}
