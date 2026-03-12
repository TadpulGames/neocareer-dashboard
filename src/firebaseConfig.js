// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithCustomToken,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    signOut
} from "firebase/auth";
import {
    getStorage,
    ref,
    uploadString,
    uploadBytes,
    getDownloadURL,
    uploadBytesResumable,
    listAll
} from "firebase/storage";
import {
    getFirestore,
    doc,
    setDoc,
    updateDoc,
    arrayUnion,
    getDoc,
    deleteDoc,
    deleteField,
    FieldPath,
    addDoc,
    collection,
} from "firebase/firestore";
// Add Functions imports
import { getFunctions, httpsCallable } from "firebase/functions";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTHDOMAIN,
    projectId: process.env.REACT_APP_PROJECT_ID,
    storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "candidate-sourcing");
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const storage = getStorage(app);
// Initialize Firebase Functions
const functions = getFunctions(app);

export {
    auth,
    db,
    collection,
    addDoc,
    provider,
    signInWithPopup,
    signInWithCustomToken,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    signOut,
    doc,
    setDoc,
    updateDoc,
    deleteField,
    arrayUnion,
    getDoc,
    deleteDoc,
    storage,
    ref,
    uploadBytes,
    getDownloadURL,
    uploadBytesResumable,
    uploadString,
    listAll,
    FieldPath,
    functions,
    getFunctions,
    httpsCallable
};  // Export getDoc