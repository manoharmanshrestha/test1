import React, { useState, useEffect, useCallback } from 'react';
import { Phone, User, CheckCircle, Globe, Loader, AlertTriangle, CloudOff } from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { setLogLevel } from 'firebase/app'; // For setting log level

/**
 * Main application component for the contact information form.
 * It handles state management, Firebase authentication/saving, and the Gemini API call.
 */
const App = () => {
  // Global variables provided by the Canvas environment
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
  const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

  // --- State Variables ---
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submittedData, setSubmittedData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Firebase and Auth state
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Gemini API state
  const [prediction, setPrediction] = useState(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusType, setStatusType] = useState(null); // 'error', 'success', 'info'

  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    // Set Firestore log level for debugging
    setLogLevel('debug');
    
    try {
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      setDb(getFirestore(app));

      const authenticate = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Firebase Auth Error:", error);
          setStatusMessage("Authentication failed. Check console for details.");
          setStatusType('error');
        }
      };

      // Listener to get the user ID once authenticated
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
          console.log(`Authenticated with UID: ${user.uid}`);
        } else {
          // If not authenticated (shouldn't happen often due to token), authenticate
          authenticate();
        }
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase Initialization Error:", e);
      setStatusMessage("Firebase failed to initialize. Check console.");
      setStatusType('error');
      setIsAuthReady(true); // Mark as ready even if failed to stop loading
    }
  }, []); // Run only once on mount

  // --- API Functions ---

  // Function to call Gemini API for country prediction
  const predictCountryOfOrigin = useCallback(async (contactName, contactNumber) => {
    setIsPredicting(true);
    setPrediction(null);
    setStatusMessage('Predicting country...');
    setStatusType('info');

    const userQuery = `Analyze the name "${contactName}" and the phone number "${contactNumber}". Based on international dialing codes and typical naming conventions, predict the most likely country of origin for this person. Provide a single, concise country name and an explanation in a single paragraph.`;

    const apiKey = ""; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        // Use Google Search for grounding the prediction on real-world data
        tools: [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: "You are an expert geopolitical and name analysis assistant." }]
        },
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Could not determine country of origin.";
        
        setPrediction(text);
        setStatusMessage('Prediction complete!');
        setStatusType('success');

    } catch (err) {
        console.error("Gemini API Error:", err);
        setStatusMessage("Failed to predict country. Check console for API errors.");
        setStatusType('error');
    } finally {
        setIsPredicting(false);
    }
  }, []);


  // --- Firestore Functions ---

  // Function to save contact data to Firestore
  const saveContactToFirestore = useCallback(async (data) => {
    if (!db || !userId) {
      throw new Error("Firestore or User ID not available for saving.");
    }
    
    // Public collection path: /artifacts/{appId}/public/data/contacts
    const contactRef = doc(collection(getFirestore(), 'artifacts', appId, 'public', 'data', 'contacts'));
    
    const saveData = {
        ...data,
        userId: userId,
        createdAt: serverTimestamp(),
        // Prediction will be added later
    };

    try {
        await setDoc(contactRef, saveData);
        console.log("Document successfully written with ID:", contactRef.id);
        return contactRef.id;
    } catch (error) {
        console.error("Error writing document to Firestore:", error);
        throw new Error("Failed to save data to cloud. Check console.");
    }
  }, [db, appId, userId]);


  // --- Form Handlers ---

  /**
   * Simple validation function for the phone number.
   * Checks if it contains only digits and is a reasonable length.
   */
  const validatePhoneNumber = (number) => {
    const phoneRegex = /^\d{7,15}$/; // Simple check for 7 to 15 digits
    return phoneRegex.test(number);
  };

  /**
   * Handles the form submission event.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmittedData(null);
    setPrediction(null);
    setStatusMessage(null);
    setStatusType(null);

    if (!isAuthReady) {
        setStatusMessage('Authentication is not ready. Please wait a moment.');
        setStatusType('info');
        return;
    }
    
    if (!name.trim() || !validatePhoneNumber(phoneNumber)) {
      setStatusMessage('Please enter a valid name and phone number (7-15 digits only).');
      setStatusType('error');
      return;
    }

    setIsSubmitting(true);
    
    const contactData = {
        name: name.trim(),
        phoneNumber: phoneNumber,
    };

    try {
        // 1. Save to Firestore
        setStatusMessage('Saving contact data to Firestore...');
        setStatusType('info');
        const docId = await saveContactToFirestore(contactData);

        // 2. Call Gemini for prediction
        await predictCountryOfOrigin(contactData.name, contactData.phoneNumber);

        // 3. Update UI states
        setSubmittedData({ ...contactData, docId });
        setName('');
        setPhoneNumber('');
        setStatusMessage('Data saved and prediction requested!');
        setStatusType('success');

    } catch (error) {
        console.error("Submission Process Failed:", error);
        setStatusMessage(error.message || "An unexpected error occurred during submission.");
        setStatusType('error');
    } finally {
        setIsSubmitting(false);
    }
  };


  // --- UI Components ---
  
  // Input component for reuse
  const InputField = ({ icon: Icon, value, onChange, placeholder, type = 'text', maxLength }) => (
    <div className="relative mb-6">
      <Icon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-indigo-400" />
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 shadow-sm text-gray-700"
        required
        disabled={isSubmitting || isPredicting}
      />
    </div>
  );

  // Status message display
  const StatusAlert = ({ message, type }) => {
    if (!message) return null;

    let classes = 'p-4 rounded-xl mb-6 flex items-start shadow-lg text-sm';
    let Icon = AlertTriangle;

    switch (type) {
      case 'success':
        classes += ' bg-green-50 border border-green-200 text-green-700';
        Icon = CheckCircle;
        break;
      case 'error':
        classes += ' bg-red-50 border border-red-200 text-red-700';
        Icon = AlertTriangle;
        break;
      case 'info':
      default:
        classes += ' bg-blue-50 border border-blue-200 text-blue-700';
        Icon = Loader; // Use Loader for 'info' (like loading/predicting)
        break;
    }
    
    return (
      <div className={classes}>
        <Icon className={`w-5 h-5 mr-3 ${type === 'info' && 'animate-spin'}`} />
        <p className="font-medium">{message}</p>
      </div>
    );
  };
  
  // Prediction Result Display
  const PredictionResult = () => {
    if (isPredicting) {
        return (
            <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-xl mb-6 flex items-center justify-center text-indigo-700 shadow-md">
                <Loader className="w-5 h-5 mr-3 animate-spin" />
                <p className="font-semibold">Gemini is analyzing the data...</p>
            </div>
        );
    }
    
    if (prediction) {
        return (
            <div className="bg-white border border-gray-200 p-6 rounded-xl mb-6 shadow-xl">
                <div className="flex items-center mb-3">
                    <Globe className="w-6 h-6 mr-3 text-indigo-600" />
                    <h3 className="text-lg font-bold text-gray-800">Country Prediction</h3>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-gray-700">
                    <p className="text-sm italic">{prediction}</p>
                </div>
            </div>
        );
    }

    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-2xl border border-gray-100">
        <div className="flex flex-col items-center mb-6">
            <h1 className="text-3xl font-extrabold text-gray-800">
              Contact & Analysis
            </h1>
            <p className="text-xs text-gray-400 mt-2">
                User ID: <span className="font-mono text-gray-600 break-all">{userId || 'Loading...'}</span>
            </p>
        </div>
        
        {!isAuthReady && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl mb-6 flex items-center justify-center text-yellow-700 shadow-md">
                <Loader className="w-5 h-5 mr-3 animate-spin" />
                <p className="font-semibold">Connecting to Firebase...</p>
            </div>
        )}

        <StatusAlert message={statusMessage} type={statusType} />
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputField
            icon={User}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full Name (e.g., John Smith)"
          />
          
          <InputField
            icon={Phone}
            value={phoneNumber}
            // Ensure only digits are entered for the phone number
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
            placeholder="Phone Number (e.g., 442079460199)"
            type="tel"
            maxLength={15}
          />

          <button
            type="submit"
            disabled={isSubmitting || isPredicting || !isAuthReady}
            className="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl shadow-md hover:bg-indigo-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {(isSubmitting || isPredicting) && <Loader className="w-5 h-5 animate-spin" />}
            <span>{isSubmitting ? 'Saving...' : (isPredicting ? 'Predicting...' : 'Submit & Analyze')}</span>
          </button>
        </form>

        <PredictionResult />

        {submittedData && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-xl font-semibold text-gray-700 mb-3">Last Submission Details</h3>
            <p className="text-sm text-gray-600">Name: <span className="font-medium text-gray-800">{submittedData.name}</span></p>
            <p className="text-sm text-gray-600">Phone: <span className="font-medium text-gray-800">{submittedData.phoneNumber}</span></p>
            <p className="text-xs text-gray-500">Saved to Firestore document: <span className="font-mono">{submittedData.docId}</span></p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
