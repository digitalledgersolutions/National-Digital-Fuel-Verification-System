/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { GoogleGenAI } from "@google/genai";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  getDoc,
  getDocFromServer,
  doc,
  setDoc,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  Camera, 
  RefreshCw, 
  LogIn, 
  LogOut, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Mail, 
  Lock, 
  UserPlus, 
  History, 
  Clock, 
  LayoutGrid, 
  ChevronRight,
  CreditCard,
  User as UserIcon,
  IdCard,
  Car,
  ShieldCheck,
  ShieldAlert,
  MoreHorizontal,
  X,
  Download,
  Pencil,
  Save,
  Settings,
  DollarSign,
  BarChart3,
  Database,
  Fuel,
  Activity
} from 'lucide-react';
import { cn } from './lib/utils';

// --- Types ---
type ScanType = 'PLATE' | 'LICENSE' | 'NID' | 'NID_BACK' | 'FACE' | 'VERIFY' | 'FUEL';

interface ScanRecord {
  id: string;
  type: ScanType;
  extractedData: string;
  imageUrl: string;
  scannedAt: string;
  userId: string;
  metadata?: {
    licenseNumber?: string;
    nidNumber?: string;
    nidAge?: string;
    nidName?: string;
    address?: string;
    identifier?: string;
  };
}

interface ProfileRecord {
  id: string;
  name: string;
  faceImageUrl: string;
  plateNumber?: string;
  plateImageUrl?: string;
  licenseNumber?: string;
  licenseImageUrl?: string;
  nidNumber?: string;
  nidImageUrl?: string;
  nidBackImageUrl?: string;
  licenseName?: string;
  nidName?: string;
  nidAge?: string;
  address?: string;
  createdAt: string;
  userId: string;
  metadata?: {
    nameMatch?: boolean | null;
    ageMatch?: boolean;
  };
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

// --- Constants ---
const MODEL_NAME = "gemini-3-flash-preview";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'operator'>('operator');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeScanType, setActiveScanType] = useState<ScanType>('PLATE');
  const [result, setResult] = useState<{ extractedData: string; record?: ScanRecord | ProfileRecord } | null>(null);
  const [pendingScan, setPendingScan] = useState<{ 
    extractedData: string; 
    imageUrl: string;
    plateNumber?: string;
    plateImageUrl?: string;
    licenseNumber?: string;
    licenseImageUrl?: string;
    nidNumber?: string;
    nidImageUrl?: string;
    licenseName?: string;
    nidName?: string;
    nidAge?: string;
    address?: string;
    faceShortId?: string;
    nidBackImageUrl?: string;
  } | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRecord | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editProfileData, setEditProfileData] = useState<ProfileRecord | null>(null);
  const [recentScanAlert, setRecentScanAlert] = useState<ScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanErrorModal, setScanErrorModal] = useState<{title: string, message: string} | null>(null);
  
  // View State
  const [view, setView] = useState<'scan' | 'history' | 'admin'>('scan');
  const [adminSubView, setAdminSubView] = useState<'scans' | 'profiles' | 'settings' | 'pricing' | 'reports' | 'quota'>('scans');
  const [fuelPrices, setFuelPrices] = useState({ octane: '130.00', diesel: '106.00' });
  const [quotas, setQuotas] = useState({ used: 60, total: 100 });
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const handleUpdateProfile = async () => {
    if (!editProfileData || !selectedProfile) return;
    setLoading(true);
    try {
      const profileRef = doc(db, 'profiles', selectedProfile.id);
      const updateData = {
        name: editProfileData.name,
        plateNumber: editProfileData.plateNumber || '',
        licenseNumber: editProfileData.licenseNumber || '',
        licenseName: editProfileData.licenseName || '',
        nidNumber: editProfileData.nidNumber || '',
        nidName: editProfileData.nidName || '',
        nidAge: editProfileData.nidAge || '',
        address: editProfileData.address || '',
        nidBackImageUrl: editProfileData.nidBackImageUrl || '',
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(profileRef, updateData, { merge: true });
      
      setSelectedProfile({ ...selectedProfile, ...updateData });
      setIsEditingProfile(false);
      setEditProfileData(null);
    } catch (err) {
      console.error("Error updating profile:", err);
      setError("Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Auth Form State
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'google'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('operator');
  const [authLoading, setAuthLoading] = useState(false);
  const [subScanModal, setSubScanModal] = useState<ScanType | null>(null);
  
  const webcamRef = useRef<Webcam>(null);
  const subWebcamRef = useRef<Webcam>(null);

  // --- Firebase Error Handler ---
  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setError(`Database error: ${errInfo.error}`);
    throw new Error(JSON.stringify(errInfo));
  };

  // --- Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Fetch user role
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            const role = userDocSnap.data().role as 'admin' | 'operator';
            setUserRole(role);
            setIsAdmin(role === 'admin' || user.email === 'admin@islambrothersltd.com' || user.email === 'diamondvaiteam@gmail.com' || user.email === 'mdrifathossainpersonal@gmail.com');
          } else {
            // Create user profile if it doesn't exist
            const role = (user.email === 'admin@islambrothersltd.com' || user.email === 'diamondvaiteam@gmail.com' || user.email === 'mdrifathossainpersonal@gmail.com') ? 'admin' : 'operator';
            await setDoc(userDocRef, {
              email: user.email,
              role: role,
              createdAt: new Date().toISOString()
            });
            setUserRole(role);
            setIsAdmin(role === 'admin' || user.email === 'admin@islambrothersltd.com' || user.email === 'diamondvaiteam@gmail.com' || user.email === 'mdrifathossainpersonal@gmail.com');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
          // Fallback to email check if Firestore fails
          const isEmailAdmin = user.email === 'admin@islambrothersltd.com' || user.email === 'diamondvaiteam@gmail.com' || user.email === 'mdrifathossainpersonal@gmail.com';
          setIsAdmin(isEmailAdmin);
          setUserRole(isEmailAdmin ? 'admin' : 'operator');
        }
      } else {
        setUserRole('operator');
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      setAuthLoading(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(`Google Login failed: ${err.message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setAuthLoading(true);
    setError(null);
    
    try {
      if (authMode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Save role to Firestore
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          email: userCredential.user.email,
          role: role,
          createdAt: new Date().toISOString()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      let msg = err.message;
      if (err.code === 'auth/email-already-in-use') msg = "Email already registered.";
      if (err.code === 'auth/invalid-credential') msg = "Invalid email or password.";
      if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";
      setError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => signOut(auth);

  // --- History Fetching ---
  useEffect(() => {
    if (!user || (view !== 'history' && view !== 'admin')) return;

    if (view === 'admin' && adminSubView === 'profiles') {
      const profilesRef = collection(db, 'profiles');
      let q;
      
      if (isAdmin) {
        // Admin: see all profiles
        q = query(
          profilesRef,
          orderBy("createdAt", "desc"),
          limit(100)
        );
      } else {
        // User: see only own profiles (though this is admin view, safety first)
        q = query(
          profilesRef,
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(50)
        );
      }

      setHistoryLoading(true);
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const records = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ProfileRecord[];
        setProfiles(records);
        setHistoryLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'profiles');
        setHistoryLoading(false);
      });
      return () => unsubscribe();
    }

    const scansRef = collection(db, 'scans');
    let q;
    
    if (view === 'admin') {
      // Admin view: see all scans (if user is admin)
      q = query(
        scansRef,
        orderBy("scannedAt", "desc"),
        limit(100)
      );
    } else {
      // History view: see only own scans
      q = query(
        scansRef, 
        where("userId", "==", user.uid),
        orderBy("scannedAt", "desc"),
        limit(50)
      );
    }

    setHistoryLoading(true);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ScanRecord[];
      setHistory(records);
      setHistoryLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'scans');
      setHistoryLoading(false);
    });

    return () => unsubscribe();
  }, [user, view, adminSubView, isAdmin]);

  // --- AI Logic ---
  const extractDataFromImage = async (base64Image: string, type: ScanType): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    
    let prompt = "";
    switch(type) {
      case 'PLATE':
        prompt = "Extract the license plate number from this image. Return ONLY the plate number, nothing else. If no plate is found, return 'NOT_FOUND'.";
        break;
      case 'LICENSE':
        prompt = "Extract the full name, license number, and address from this Driving License. Return ONLY a JSON object: {\"name\": \"...\", \"id\": \"...\", \"address\": \"...\"}. If not found, return 'NOT_FOUND'.";
        break;
      case 'NID':
        prompt = "Extract the full name, NID number, age, and address from this NID card. Return ONLY a JSON object: {\"name\": \"...\", \"id\": \"...\", \"age\": \"...\", \"address\": \"...\"}. If not found, return 'NOT_FOUND'.";
        break;
      case 'NID_BACK':
        prompt = "Extract the address from this NID card back. Return ONLY a JSON object: {\"address\": \"...\"}. If no address is found, return 'NOT_FOUND'.";
        break;
      case 'FACE':
        prompt = "Describe the person in this image briefly (age range, gender, key features). Also provide a 'shortId' which is a consistent string based on their gender, approximate age, and most prominent feature (e.g., 'MALE_30S_BEARD'). Return ONLY a JSON object: {\"description\": \"...\", \"shortId\": \"...\"}. If no face is found, return 'NOT_FOUND'.";
        break;
      case 'VERIFY':
        prompt = "Analyze this image for a person's face or a vehicle license plate. If a face is found, provide a 'shortId' (gender_age_feature). If a plate is found, provide the plate number. Return ONLY a JSON object: {\"type\": \"FACE\" | \"PLATE\", \"id\": \"...\"}. If neither is found, return 'NOT_FOUND'.";
        break;
    }

    const model = ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } }
          ]
        }
      ]
    });

    const response = await model;
    const text = response.text?.trim() || "NOT_FOUND";
    return text;
  };

  // --- Scan Logic ---
  const handleScan = useCallback(async () => {
    if (!webcamRef.current || !user) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error("Could not capture image");

      const extractedData = await extractDataFromImage(imageSrc, activeScanType);
      
      if (extractedData === "NOT_FOUND") {
        setScanErrorModal({
          title: "Detection Failed",
          message: `Could not detect a clear ${activeScanType.toLowerCase()} in the image. Please ensure the item is well-lit and clearly visible in the frame.`
        });
        setLoading(false);
        return;
      }

      // Parse JSON if needed
      let displayData = extractedData;
      let licenseName = '';
      let licenseNumber = '';
      let nidName = '';
      let nidNumber = '';
      let nidAge = '';
      let address = '';
      let faceShortId = '';

      if (activeScanType === 'LICENSE') {
        try {
          const cleaned = extractedData.replace(/```json|```/g, '').trim();
          const json = JSON.parse(cleaned);
          licenseName = json.name || '';
          licenseNumber = json.id || '';
          address = json.address || '';
          displayData = licenseName ? `${licenseName} (${licenseNumber})` : licenseNumber;
        } catch (e) {
          displayData = extractedData;
        }
      } else if (activeScanType === 'NID') {
        try {
          const cleaned = extractedData.replace(/```json|```/g, '').trim();
          const json = JSON.parse(cleaned);
          nidName = json.name || '';
          nidNumber = json.id || '';
          nidAge = json.age || '';
          address = json.address || '';
          displayData = nidName ? `${nidName} (${nidNumber})` : nidNumber;
        } catch (e) {
          displayData = extractedData;
        }
      } else if (activeScanType === 'FACE') {
        try {
          const cleaned = extractedData.replace(/```json|```/g, '').trim();
          const json = JSON.parse(cleaned);
          displayData = json.description || extractedData;
          faceShortId = json.shortId || '';
        } catch (e) {
          displayData = extractedData;
        }
      } else if (activeScanType === 'VERIFY') {
        try {
          const cleaned = extractedData.replace(/```json|```/g, '').trim();
          const json = JSON.parse(cleaned);
          const verifyId = json.id || '';
          const verifyType = json.type || '';

          const normalize = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const normalVerifyId = normalize(verifyId);

          const profilesRef = collection(db, 'profiles');
          const profileSnapshot = await getDocs(profilesRef);
          const matchedProfile = profileSnapshot.docs
            .map(d => ({ id: d.id, ...d.data() } as ProfileRecord))
            .find(p => 
              normalize(p.plateNumber || '') === normalVerifyId || 
              normalize(p.licenseNumber || '') === normalVerifyId || 
              normalize(p.nidNumber || '') === normalVerifyId ||
              normalize(p.name || '') === normalVerifyId ||
              (verifyType === 'FACE' && p.faceImageUrl.includes(verifyId))
            );

          if (matchedProfile) {
            setResult({
              extractedData: matchedProfile.name,
              record: { 
                id: matchedProfile.id, 
                type: 'FACE', 
                extractedData: matchedProfile.name, 
                imageUrl: matchedProfile.faceImageUrl, 
                scannedAt: matchedProfile.createdAt, 
                userId: matchedProfile.userId 
              } as ScanRecord
            });
            setLoading(false);
            return;
          } else {
            setScanErrorModal({
              title: "Scan Failed",
              message: `No profile found for this ${verifyType.toLowerCase()} (${verifyId}). Please ensure the person is registered in the system.`
            });
            setLoading(false);
            return;
          }
        } catch (e) {
          setScanErrorModal({
            title: "Verification Error",
            message: "Could not process the verification image. Please try again with better lighting."
          });
          setLoading(false);
          return;
        }
      }

      // Check for recent scans of this person/item in the last 24 hours
      if (activeScanType === 'VERIFY') return;
      
      const scansRef = collection(db, 'scans');
      const profilesRef = collection(db, 'profiles');
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let identifier = extractedData;
      let checkType = activeScanType;

      if (activeScanType === 'LICENSE') identifier = licenseNumber;
      if (activeScanType === 'NID') identifier = nidNumber;
      if (activeScanType === 'FACE') identifier = faceShortId || extractedData;

      // 1. Find all identifiers for this person via their profile
      const identifiersToCheck = [identifier];
      try {
        const profileSnapshot = await getDocs(profilesRef);
        const matchedProfile = profileSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as ProfileRecord))
          .find(p => 
            p.plateNumber === identifier || 
            p.licenseNumber === identifier || 
            p.nidNumber === identifier ||
            p.name === identifier ||
            (activeScanType === 'FACE' && p.faceImageUrl.includes(identifier)) // Fallback for face
          );

        if (matchedProfile) {
          if (matchedProfile.plateNumber) identifiersToCheck.push(matchedProfile.plateNumber);
          if (matchedProfile.licenseNumber) identifiersToCheck.push(matchedProfile.licenseNumber);
          if (matchedProfile.nidNumber) identifiersToCheck.push(matchedProfile.nidNumber);
          if (matchedProfile.name) identifiersToCheck.push(matchedProfile.name);
        }
      } catch (err) {
        console.error("Profile lookup error:", err);
      }

      // 2. Check for recent scans of ANY of these identifiers
      try {
        const recentSnapshot = await getDocs(scansRef);
        const recentDocs = recentSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as ScanRecord))
          .filter(r => 
            r.scannedAt >= oneDayAgo && 
            (identifiersToCheck.includes(r.metadata?.identifier || '') || identifiersToCheck.includes(r.extractedData))
          )
          .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));

        if (recentDocs.length > 0) {
          setRecentScanAlert(recentDocs[0]);
        } else {
          setRecentScanAlert(null);
        }
      } catch (err) {
        console.error("Recent scan query error:", err);
        setRecentScanAlert(null);
      }

      // For plates, we check for existing records
      if (activeScanType === 'PLATE') {
        const q = query(scansRef, where("extractedData", "==", extractedData), where("type", "==", "PLATE"));
        let querySnapshot;
        try {
          querySnapshot = await getDocs(q);
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'scans');
          return;
        }

        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          setResult({
            extractedData,
            record: { id: doc.id, ...doc.data() } as ScanRecord
          });
          setLoading(false);
          return;
        }
      }

      // For others or new plates, ask for confirmation
      setPendingScan({
        extractedData: displayData,
        imageUrl: imageSrc,
        licenseName,
        licenseNumber,
        nidName,
        nidNumber,
        nidAge,
        address,
        faceShortId
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [user, activeScanType]);

  const scanSubItem = useCallback(async (type: ScanType) => {
    const ref = subWebcamRef.current ? subWebcamRef : webcamRef;
    if (!ref.current || !user) return;
    
    setLoading(true);
    setError(null);

    try {
      const imageSrc = ref.current.getScreenshot();
      if (!imageSrc) throw new Error("Could not capture image");

      const extractedData = await extractDataFromImage(imageSrc, type);
      
      if (extractedData === "NOT_FOUND") {
        setError(`No ${type.toLowerCase()} detected. Please try again.`);
        return;
      }

      setPendingScan(prev => {
        if (!prev) return null;
        if (type === 'PLATE') return { ...prev, plateNumber: extractedData, plateImageUrl: imageSrc };
        if (type === 'LICENSE') {
          try {
            const cleaned = extractedData.replace(/```json|```/g, '').trim();
            const json = JSON.parse(cleaned);
            return { 
              ...prev, 
              licenseNumber: json.id || '', 
              licenseName: json.name || '', 
              address: json.address || prev.address,
              licenseImageUrl: imageSrc 
            };
          } catch (e) {
            return { ...prev, licenseNumber: extractedData, licenseImageUrl: imageSrc };
          }
        }
        if (type === 'NID') {
          try {
            const cleaned = extractedData.replace(/```json|```/g, '').trim();
            const json = JSON.parse(cleaned);
            return { 
              ...prev, 
              nidNumber: json.id || '', 
              nidName: json.name || '', 
              nidAge: json.age || '', 
              address: json.address || prev.address,
              nidImageUrl: imageSrc 
            };
          } catch (e) {
            return { ...prev, nidNumber: extractedData, nidImageUrl: imageSrc };
          }
        }
        if (type === 'NID_BACK') {
          try {
            const cleaned = extractedData.replace(/```json|```/g, '').trim();
            const json = JSON.parse(cleaned);
            return { 
              ...prev, 
              address: json.address || prev.address,
              nidBackImageUrl: imageSrc 
            };
          } catch (e) {
            return { ...prev, address: extractedData, nidBackImageUrl: imageSrc };
          }
        }
        return prev;
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleDispenseFuel = async (profile: ProfileRecord) => {
    if (!user) return;
    setLoading(true);
    try {
      const scanRecord = {
        type: 'FUEL' as ScanType,
        extractedData: `Fuel Dispensed: ${profile.name}`,
        imageUrl: profile.faceImageUrl || '',
        scannedAt: new Date().toISOString(),
        userId: user.uid,
        metadata: {
          profileId: profile.id,
          amount: '20L',
          price: fuelPrices.octane
        }
      };
      await addDoc(collection(db, 'scans'), scanRecord);
      setQuotas(prev => ({ ...prev, used: Math.min(prev.total, prev.used + 20) }));
      setScanErrorModal({
        title: "Success",
        message: "Fuel allocation dispensed successfully! The record has been saved to the history."
      });
      setResult(null);
      setPendingScan(null);
    } catch (err) {
      console.error("Dispense error:", err);
      setError("Failed to record fuel dispense.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!pendingScan || !user) return;
    
    // If it's a duplicate, ask for confirmation first
    if (recentScanAlert && !window.confirm(`This ${recentScanAlert.type.toLowerCase()} was already scanned today. Are you sure you want to save it again?`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (activeScanType === 'FACE') {
        const profilesRef = collection(db, 'profiles');
        
        // Fallback logic for name:
        // 1. Use text box (extractedData) if not empty
        // 2. Fallback to Plate Number
        // 3. Fallback to License Number
        // 4. Fallback to NID Number
        let finalName = pendingScan.extractedData.trim();
        if (!finalName) {
          finalName = pendingScan.plateNumber || pendingScan.licenseNumber || pendingScan.nidNumber || 'Unknown Person';
        }
        
        const newProfile = {
          name: finalName,
          faceImageUrl: pendingScan.imageUrl,
          plateNumber: pendingScan.plateNumber || '',
          plateImageUrl: pendingScan.plateImageUrl || '',
          licenseNumber: pendingScan.licenseNumber || '',
          licenseImageUrl: pendingScan.licenseImageUrl || '',
          nidNumber: pendingScan.nidNumber || '',
          nidImageUrl: pendingScan.nidImageUrl || '',
          nidBackImageUrl: pendingScan.nidBackImageUrl || '',
          licenseName: pendingScan.licenseName || '',
          nidName: pendingScan.nidName || '',
          nidAge: pendingScan.nidAge || '',
          address: pendingScan.address || '',
          createdAt: new Date().toISOString(),
          userId: user.uid,
          metadata: {
            nameMatch: pendingScan.licenseName && pendingScan.nidName ? pendingScan.licenseName === pendingScan.nidName : null,
            ageMatch: true // Placeholder for age logic if needed
          }
        };
        await addDoc(profilesRef, newProfile);
        setResult({ extractedData: finalName });
      } else {
        const scansRef = collection(db, 'scans');
        
        // Special logic for LICENSE: save under the name
        let finalData = pendingScan.extractedData;
        if (activeScanType === 'LICENSE' && pendingScan.licenseName) {
          finalData = pendingScan.licenseName;
        } else if (activeScanType === 'PLATE') {
          finalData = pendingScan.extractedData; // Already plate number
        }

        const newRecord = {
          type: activeScanType,
          extractedData: finalData,
          imageUrl: pendingScan.imageUrl,
          scannedAt: new Date().toISOString(),
          userId: user.uid,
          metadata: {
            licenseNumber: pendingScan.licenseNumber,
            nidNumber: pendingScan.nidNumber,
            nidAge: pendingScan.nidAge,
            nidName: pendingScan.nidName,
            address: pendingScan.address,
            identifier: activeScanType === 'PLATE' ? pendingScan.extractedData : 
                        activeScanType === 'LICENSE' ? pendingScan.licenseNumber :
                        activeScanType === 'NID' ? pendingScan.nidNumber : 
                        pendingScan.faceShortId || pendingScan.extractedData
          }
        };
        await addDoc(scansRef, newRecord);
        setResult({ extractedData: finalData });
      }
      
      setPendingScan(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, activeScanType === 'FACE' ? 'profiles' : 'scans');
    } finally {
      setLoading(false);
    }
  };

  // --- Connection Test ---
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
            setError("Firebase connection error. Please check your config.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
              <Fuel className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 uppercase">Fuel System</h1>
            <p className="text-slate-500 font-medium">Sign in to access your terminal</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center gap-3 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-400 tracking-wider ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-400 tracking-wider ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                  required
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider ml-1">Account Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('operator')}
                    className={cn(
                      "py-3 rounded-xl text-xs font-bold uppercase tracking-widest border-2 transition-all",
                      role === 'operator' ? "bg-primary border-primary text-white shadow-lg shadow-primary/20" : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                    )}
                  >
                    Pump Terminal
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={cn(
                      "py-3 rounded-xl text-xs font-bold uppercase tracking-widest border-2 transition-all",
                      role === 'admin' ? "bg-primary border-primary text-white shadow-lg shadow-primary/20" : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                    )}
                  >
                    Full Dashboard
                  </button>
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={authLoading}
              className="w-full py-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl shadow-primary/20"
            >
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                authMode === 'signup' ? <UserPlus className="w-5 h-5" /> : <LogIn className="w-5 h-5" />
              )}
              {authMode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Or continue with</span></div>
          </div>

          <button 
            onClick={loginWithGoogle}
            disabled={authLoading}
            className="w-full py-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Google Login
          </button>

          <p className="text-center text-sm text-slate-500">
            {authMode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button 
              onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}
              className="text-primary font-bold hover:underline"
            >
              {authMode === 'signup' ? 'Sign In' : 'Create one'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Fuel className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tight hidden sm:block text-slate-900 uppercase italic">Fuel BD Pro</h1>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex items-center bg-slate-100 p-1 rounded-xl mr-2">
            <button 
              onClick={() => setView('scan')}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                view === 'scan' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Scan
            </button>
            <button 
              onClick={() => setView('history')}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                view === 'history' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              History
            </button>
            {isAdmin && (
              <button 
                onClick={() => setView('admin')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                  view === 'admin' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Dashboard
              </button>
            )}
          </nav>
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Operator</span>
            <span className="text-xs font-bold text-slate-600">{user.email?.split('@')[0]}</span>
          </div>
          <button 
            onClick={logout}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-destructive"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 pb-32">
        {view === 'scan' ? (
          <>
            {/* Dashboard Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Today's Scans</p>
                  <p className="text-xl font-black text-slate-900">{history.filter(h => new Date(h.scannedAt) > new Date(new Date().setHours(0,0,0,0))).length}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-600">
                  <Fuel className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fuel Quota</p>
                  <p className="text-xl font-black text-slate-900">{quotas.used} / {quotas.total} L</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
                  <UserIcon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Profiles</p>
                  <p className="text-xl font-black text-slate-900">{profiles.length}</p>
                </div>
              </div>
            </div>

            {/* Scan Type Selector */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {[
                { id: 'FACE', label: 'Register Face', icon: UserIcon, color: 'bg-blue-600' },
                { id: 'VERIFY', label: 'Verify & Dispense', icon: ShieldCheck, color: 'bg-green-600' },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setActiveScanType(type.id as ScanType);
                    setResult(null);
                    setPendingScan(null);
                    setError(null);
                    setRecentScanAlert(null);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-3 p-6 rounded-3xl border-2 transition-all active:scale-95",
                    activeScanType === type.id 
                      ? `${type.color} border-transparent text-white shadow-xl shadow-slate-900/10` 
                      : "bg-white border-slate-100 text-slate-500 hover:border-slate-300"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                    activeScanType === type.id ? "bg-white/20" : "bg-slate-50"
                  )}>
                    <type.icon className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest">{type.label}</span>
                </button>
              ))}
            </div>

            {/* Recent Scan Warning */}
            {recentScanAlert && (
              <div className="bg-amber-50 border-2 border-amber-200 p-6 rounded-[2.5rem] flex items-start gap-4 animate-in slide-in-from-top-4 duration-300 shadow-lg shadow-amber-900/5">
                <div className="w-12 h-12 rounded-2xl bg-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-amber-900 uppercase tracking-widest">Duplicate Scan Alert</p>
                  <p className="text-sm font-bold text-amber-800 leading-relaxed">
                    This {recentScanAlert.type.toLowerCase()} was already scanned within the last 24 hours.
                  </p>
                  <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-amber-100/50 rounded-xl w-fit">
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                      Last seen: {new Date(recentScanAlert.scannedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              {/* Camera Section */}
              <section className="space-y-4 lg:sticky lg:top-24">
                <div className="relative aspect-[4/3] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl shadow-slate-900/20 border-8 border-white">
                {!result && !loading && (activeScanType === 'FACE' || !pendingScan) ? (
                  <div className="w-full h-full relative">
                    <Webcam
                      {...({
                        audio: false,
                        ref: webcamRef,
                        screenshotFormat: "image/jpeg",
                        className: "w-full h-full object-cover",
                        videoConstraints: { facingMode: "environment" },
                        screenshotQuality: 1
                      } as any)}
                    />
                    
                    {pendingScan && activeScanType === 'FACE' && (
                      <div className="absolute bottom-6 right-6 w-28 h-36 rounded-2xl border-4 border-white shadow-2xl z-20 overflow-hidden animate-in zoom-in-50">
                        <img src={pendingScan.imageUrl} className="w-full h-full object-cover" alt="Face" />
                        <div className="absolute inset-0 bg-black/20 flex items-end p-2">
                          <span className="text-[8px] font-black text-white uppercase tracking-widest w-full text-center">Face Captured</span>
                        </div>
                      </div>
                    )}

                    {/* Visual Indicator Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
                      <div className={cn(
                        "border-2 border-white/40 border-dashed flex flex-col items-center justify-center relative animate-[pulse-border_3s_ease-in-out_infinite] transition-all duration-500",
                        activeScanType === 'FACE' ? "w-full max-w-[240px] aspect-[3/4] rounded-[100px]" : "w-full h-[40%] rounded-3xl"
                      )}>
                        {/* Corner Brackets */}
                        <div className="w-12 h-12 border-t-4 border-l-4 border-white absolute -top-1 -left-1 rounded-tl-2xl" />
                        <div className="w-12 h-12 border-t-4 border-r-4 border-white absolute -top-1 -right-1 rounded-tr-2xl" />
                        <div className="w-12 h-12 border-b-4 border-l-4 border-white absolute -bottom-1 -left-1 rounded-bl-2xl" />
                        <div className="w-12 h-12 border-b-4 border-r-4 border-white absolute -bottom-1 -right-1 rounded-br-2xl" />
                        
                        <div className="bg-black/40 backdrop-blur-md px-6 py-2 rounded-full border border-white/20 relative z-10">
                          <span className="text-white text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            Align {pendingScan && activeScanType === 'FACE' ? 'Sub-item' : activeScanType}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-50">
                    {loading ? (
                      <div className="text-center space-y-6">
                        <div className="relative inline-block">
                          <Loader2 className="w-16 h-16 animate-spin text-primary mx-auto" />
                          <div className="absolute inset-0 blur-2xl bg-primary/10 animate-pulse" />
                        </div>
                        <p className="text-slate-900 font-black uppercase tracking-[0.2em] text-xs animate-pulse">Analyzing Data...</p>
                      </div>
                    ) : (result?.record?.imageUrl || pendingScan?.imageUrl) ? (
                      <img 
                        src={result?.record?.imageUrl || pendingScan?.imageUrl} 
                        alt="Scanned Item" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-slate-300 flex flex-col items-center gap-4">
                        <Camera className="w-16 h-16 opacity-10" />
                        <p className="font-black uppercase tracking-widest text-[10px]">Ready to scan</p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Scanning Effect */}
                {loading && (
                  <div className="absolute inset-0 bg-primary/5 pointer-events-none overflow-hidden">
                    <div className="w-full h-1 bg-primary/40 absolute top-0 animate-[scan_2s_linear_infinite]" />
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                {!result && !pendingScan && !loading ? (
                  <button 
                    onClick={handleScan}
                    disabled={loading}
                    className="flex-1 py-6 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-3xl font-black text-xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] shadow-2xl shadow-primary/20"
                  >
                    <Camera className="w-7 h-7" />
                    SCAN {activeScanType}
                  </button>
                ) : (
                  <button 
                    onClick={() => { setResult(null); setPendingScan(null); setError(null); setRecentScanAlert(null); }}
                    className="flex-1 py-6 bg-white border-4 border-slate-900 text-slate-900 rounded-3xl font-black text-xl flex items-center justify-center gap-4 transition-all active:scale-[0.98]"
                  >
                    <RefreshCw className="w-7 h-7" />
                    {pendingScan ? 'CANCEL' : 'NEW SCAN'}
                  </button>
                )}
              </div>
            </section>

              {/* Status/Result Section */}
              <section className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-100 p-6 rounded-3xl flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
                  <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-red-900 uppercase text-xs tracking-widest">Scan Failed</h3>
                    <p className="text-red-700 text-sm font-medium mt-1">{error}</p>
                  </div>
                </div>
              )}

              {pendingScan && (
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 animate-in fade-in slide-in-from-bottom-4 space-y-6">
                  {/* Alert inside confirmation UI */}
                  {recentScanAlert && (
                    <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-amber-900 uppercase tracking-widest">Duplicate Detected</p>
                        <p className="text-xs font-bold text-amber-800">
                          Already scanned at {new Date(recentScanAlert.scannedAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Verification Status */}
                  {activeScanType === 'FACE' && (pendingScan.nidName || pendingScan.licenseName) && (
                    <div className={cn(
                      "p-4 rounded-2xl border-2 flex items-center gap-3",
                      (pendingScan.extractedData.toLowerCase().includes((pendingScan.nidName || pendingScan.licenseName || '').toLowerCase()) || 
                       (pendingScan.nidName || pendingScan.licenseName || '').toLowerCase().includes(pendingScan.extractedData.toLowerCase()))
                        ? "bg-green-50 border-green-200"
                        : "bg-red-50 border-red-200"
                    )}>
                      {(pendingScan.extractedData.toLowerCase().includes((pendingScan.nidName || pendingScan.licenseName || '').toLowerCase()) || 
                        (pendingScan.nidName || pendingScan.licenseName || '').toLowerCase().includes(pendingScan.extractedData.toLowerCase())) ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600" />
                      )}
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Verification Status</p>
                        <p className={cn(
                          "text-xs font-bold",
                          (pendingScan.extractedData.toLowerCase().includes((pendingScan.nidName || pendingScan.licenseName || '').toLowerCase()) || 
                           (pendingScan.nidName || pendingScan.licenseName || '').toLowerCase().includes(pendingScan.extractedData.toLowerCase()))
                            ? "text-green-700"
                            : "text-red-700"
                        )}>
                          {(pendingScan.extractedData.toLowerCase().includes((pendingScan.nidName || pendingScan.licenseName || '').toLowerCase()) || 
                            (pendingScan.nidName || pendingScan.licenseName || '').toLowerCase().includes(pendingScan.extractedData.toLowerCase()))
                              ? "Identity Matched"
                              : "Identity Mismatch Warning"}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Verify Extracted Data</span>
                    <div className="flex flex-col gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                          {activeScanType === 'FACE' ? 'Person Name / Description' : 'Extracted Data'}
                        </label>
                        {activeScanType === 'FACE' ? (
                          <textarea 
                            value={pendingScan.extractedData}
                            onChange={(e) => setPendingScan({ ...pendingScan, extractedData: e.target.value })}
                            placeholder="Enter person name or leave empty to use Plate/License/NID as name..."
                            readOnly={userRole === 'operator'}
                            className={cn(
                              "w-full text-sm border-2 rounded-2xl px-6 py-4 focus:outline-none transition-all min-h-[80px]",
                              userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                            )}
                          />
                        ) : (
                          <input 
                            type="text"
                            value={pendingScan.extractedData}
                            onChange={(e) => setPendingScan({ ...pendingScan, extractedData: e.target.value.toUpperCase() })}
                            readOnly={userRole === 'operator'}
                            className={cn(
                              "w-full text-2xl font-black uppercase tracking-widest border-2 rounded-2xl px-6 py-4 focus:outline-none transition-all",
                              userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                            )}
                          />
                        )}
                      </div>

                      {activeScanType === 'FACE' && (
                        <div className="grid grid-cols-1 gap-4 pt-4 border-t border-slate-100">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center justify-between">
                              <span className="flex items-center gap-2"><Car className="w-3 h-3" /> Plate Number</span>
                              {userRole !== 'operator' && (
                                <button onClick={() => setSubScanModal('PLATE')} className="text-primary hover:underline flex items-center gap-1">
                                  <Camera className="w-3 h-3" /> Scan
                                </button>
                              )}
                            </label>
                            <input 
                              type="text"
                              value={pendingScan.plateNumber || ''}
                              onChange={(e) => setPendingScan({ ...pendingScan, plateNumber: e.target.value.toUpperCase() })}
                              placeholder="e.g. DHAKA METRO-KA-1234"
                              readOnly={userRole === 'operator'}
                              className={cn(
                                "w-full text-sm font-bold uppercase tracking-widest border-2 rounded-xl px-4 py-3 focus:outline-none transition-all",
                                userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center justify-between">
                              <span className="flex items-center gap-2"><CreditCard className="w-3 h-3" /> Driving License</span>
                              {userRole !== 'operator' && (
                                <button onClick={() => setSubScanModal('LICENSE')} className="text-primary hover:underline flex items-center gap-1">
                                  <Camera className="w-3 h-3" /> Scan
                                </button>
                              )}
                            </label>
                            <input 
                              type="text"
                              value={pendingScan.licenseNumber || ''}
                              onChange={(e) => setPendingScan({ ...pendingScan, licenseNumber: e.target.value.toUpperCase() })}
                              placeholder="Enter License Number"
                              readOnly={userRole === 'operator'}
                              className={cn(
                                "w-full text-sm font-bold uppercase tracking-widest border-2 rounded-xl px-4 py-3 focus:outline-none transition-all",
                                userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center justify-between">
                              <span className="flex items-center gap-2"><IdCard className="w-3 h-3" /> NID Card</span>
                              {userRole !== 'operator' && (
                                <button onClick={() => setSubScanModal('NID')} className="text-primary hover:underline flex items-center gap-1">
                                  <Camera className="w-3 h-3" /> Scan
                                </button>
                              )}
                            </label>
                            <input 
                              type="text"
                              value={pendingScan.nidNumber || ''}
                              onChange={(e) => setPendingScan({ ...pendingScan, nidNumber: e.target.value.toUpperCase() })}
                              placeholder="Enter NID Number"
                              readOnly={userRole === 'operator'}
                              className={cn(
                                "w-full text-sm font-bold uppercase tracking-widest border-2 rounded-xl px-4 py-3 focus:outline-none transition-all",
                                userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center justify-between">
                              <span className="flex items-center gap-2"><Search className="w-3 h-3" /> Address</span>
                              {userRole !== 'operator' && (
                                <button onClick={() => setSubScanModal('NID_BACK')} className="text-primary hover:underline flex items-center gap-1">
                                  <Camera className="w-3 h-3" /> NID Back Scan
                                </button>
                              )}
                            </label>
                            <textarea 
                              value={pendingScan.address || ''}
                              onChange={(e) => setPendingScan({ ...pendingScan, address: e.target.value })}
                              placeholder="Enter Address"
                              readOnly={userRole === 'operator'}
                              className={cn(
                                "w-full text-sm border-2 rounded-xl px-4 py-3 focus:outline-none transition-all min-h-[60px]",
                                userRole === 'operator' ? "bg-slate-100 border-slate-100 cursor-not-allowed" : "bg-slate-50 border-slate-200 focus:border-primary"
                              )}
                            />
                            {pendingScan.nidBackImageUrl && (
                              <div className="mt-2 aspect-video rounded-xl overflow-hidden border border-slate-200">
                                <img src={pendingScan.nidBackImageUrl} className="w-full h-full object-cover" alt="NID Back Preview" />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">Please confirm if the information is correct. You can edit it if needed.</p>
                  </div>

                  <button 
                    onClick={handleConfirmSave}
                    disabled={loading}
                    className="w-full py-5 bg-primary hover:bg-primary/90 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                    Confirm & Save
                  </button>
                </div>
              )}

              {result && (
                <div className={cn(
                  "p-8 rounded-3xl border-2 animate-in fade-in slide-in-from-bottom-4",
                  result.record ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
                )}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                      {result.faceImageUrl ? (
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-sm shrink-0">
                          <img src={result.faceImageUrl} className="w-full h-full object-cover" alt="Scan Result" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center border-2 border-white shadow-sm shrink-0">
                          {result.record ? (
                            <Search className="w-8 h-8 text-amber-600" />
                          ) : (
                            <CheckCircle2 className="w-8 h-8 text-green-600" />
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest shrink-0">
                          {activeScanType === 'VERIFY' ? 'Verified' : activeScanType} Data
                        </span>
                        <h2 className="text-xl font-black uppercase tracking-widest truncate max-w-[200px]">
                          {result.extractedData}
                        </h2>
                      </div>
                    </div>
                    <span className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider",
                      result.record ? "bg-amber-200 text-amber-900" : "bg-green-200 text-green-900"
                    )}>
                      {activeScanType === 'VERIFY' ? "Profile Found" : (result.record ? "Existing Record" : "New Record Saved")}
                    </span>
                  </div>

                  {result.record && (
                    <div className="space-y-4">
                      {activeScanType === 'VERIFY' && (
                        <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl space-y-3">
                          <div className="flex items-center gap-2 text-amber-900">
                            <ShieldAlert className="w-5 h-5" />
                            <span className="text-xs font-black uppercase tracking-widest">Administrative Status</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-amber-900/50 uppercase tracking-widest">Quota Status</p>
                              <p className="text-sm font-black text-amber-900">{quotas.used}L / {quotas.total}L Used</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-amber-900/50 uppercase tracking-widest">Verification</p>
                              <p className="text-sm font-black text-green-700">AUTHORIZED</p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase font-bold text-amber-900/50 tracking-widest">Last Scanned</span>
                        <p className="text-amber-900 font-medium">
                          {new Date(result.record.scannedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="h-px bg-amber-200/50 w-full" />
                      <p className="text-amber-800/80 text-sm italic">
                        {activeScanType === 'VERIFY' 
                          ? "This profile is registered in the system." 
                          : `This ${activeScanType.toLowerCase()} was already in the database.`}
                      </p>
                    </div>
                  )}

                  {!result.record && (
                    <p className="text-green-800/80 text-sm">
                      This {activeScanType.toLowerCase()} has been successfully added to the database.
                    </p>
                  )}

                  {activeScanType === 'VERIFY' && result.record && (
                    <button 
                      onClick={() => handleDispenseFuel(result.record as any)}
                      className="w-full mt-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-green-900/20"
                    >
                      <Fuel className="w-5 h-5" />
                      Dispense Fuel Allocation
                    </button>
                  )}

                  <button 
                    onClick={() => {
                      setResult(null);
                      setPendingScan(null);
                    }}
                    className="w-full mt-4 py-4 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <RefreshCw className="w-4 h-4" />
                    New Scan
                  </button>
                </div>
              )}
              </section>
            </div>
          </>
        ) : view === 'admin' ? (
          <section className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
              <div className="space-y-1">
                <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase italic">Admin Control Panel</h2>
                <p className="text-slate-500 text-sm font-medium">Manage system records and person profiles</p>
              </div>
              
              <div className="flex flex-wrap p-1 bg-slate-100 rounded-2xl w-fit gap-1">
                <button 
                  onClick={() => setAdminSubView('scans')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'scans' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <History className="w-4 h-4" />
                  Scans
                </button>
                <button 
                  onClick={() => setAdminSubView('profiles')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'profiles' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <UserIcon className="w-4 h-4" />
                  Profiles
                </button>
                <button 
                  onClick={() => setAdminSubView('reports')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'reports' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <BarChart3 className="w-4 h-4" />
                  Reports
                </button>
                <button 
                  onClick={() => setAdminSubView('pricing')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'pricing' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <DollarSign className="w-4 h-4" />
                  Pricing
                </button>
                <button 
                  onClick={() => setAdminSubView('quota')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'quota' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <Database className="w-4 h-4" />
                  Quota
                </button>
                <button 
                  onClick={() => setAdminSubView('settings')}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                    adminSubView === 'settings' ? "bg-white text-primary shadow-lg shadow-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
              </div>
            </div>

            {adminSubView === 'profiles' ? (
              <div className="space-y-6">
                {historyLoading ? (
                  <div className="flex flex-col items-center justify-center py-32 gap-6">
                    <div className="relative">
                      <Loader2 className="w-12 h-12 animate-spin text-primary" />
                      <div className="absolute inset-0 blur-xl bg-primary/10 animate-pulse" />
                    </div>
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Syncing Profiles...</p>
                  </div>
                ) : profiles.length === 0 ? (
                  <div className="bg-white rounded-[3rem] p-16 text-center space-y-6 border-2 border-dashed border-slate-100">
                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto">
                      <UserIcon className="w-10 h-10 text-slate-200" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-black uppercase tracking-tight">No Profiles Found</h3>
                      <p className="text-slate-500 max-w-xs mx-auto text-sm font-medium">Capture faces to create unified person profiles for tracking.</p>
                    </div>
                    <button 
                      onClick={() => { setView('scan'); setActiveScanType('FACE'); }}
                      className="px-8 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-primary/20"
                    >
                      Start Face Scan
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {profiles.map((profile) => (
                      <div 
                        key={profile.id}
                        onClick={() => setSelectedProfile(profile)}
                        className="group bg-white p-6 rounded-[2.5rem] border border-slate-100 space-y-6 shadow-sm hover:shadow-2xl hover:shadow-slate-200/50 hover:-translate-y-1 transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <div className="flex gap-5 items-center">
                          <div className="w-16 h-16 bg-slate-100 rounded-[1.5rem] overflow-hidden shrink-0 border-4 border-white shadow-lg group-hover:scale-110 transition-transform">
                            <img 
                              src={profile.faceImageUrl} 
                              alt={profile.name} 
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <h3 className="text-sm font-black uppercase tracking-[0.1em] text-slate-900 truncate">{profile.name}</h3>
                            <div className="flex items-center gap-2 text-slate-400">
                              <Clock className="w-3 h-3" />
                              <span className="text-[9px] font-bold uppercase tracking-wider">
                                {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          {profile.plateNumber && (
                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100/50">
                              <div className="flex items-center gap-2">
                                <Car className="w-3 h-3 text-slate-400" />
                                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">Plate</span>
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">{profile.plateNumber}</span>
                            </div>
                          )}
                          {profile.licenseNumber && (
                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100/50">
                              <div className="flex items-center gap-2">
                                <CreditCard className="w-3 h-3 text-slate-400" />
                                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">License</span>
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">{profile.licenseNumber}</span>
                            </div>
                          )}
                          {profile.nidNumber && (
                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100/50">
                              <div className="flex items-center gap-2">
                                <IdCard className="w-3 h-3 text-slate-400" />
                                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-widest">NID</span>
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">{profile.nidNumber}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">View Details</span>
                          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : adminSubView === 'scans' ? (
              <div className="space-y-6">
                {historyLoading ? (
                  <div className="flex flex-col items-center justify-center py-32 gap-6">
                    <Loader2 className="w-12 h-12 animate-spin text-slate-200" />
                    <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Loading Scans...</p>
                  </div>
                ) : history.length === 0 ? (
                  <div className="bg-white rounded-[3rem] p-16 text-center space-y-6 border-2 border-dashed border-slate-100">
                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto">
                      <LayoutGrid className="w-10 h-10 text-slate-200" />
                    </div>
                    <h3 className="text-xl font-black uppercase tracking-tight">No Scans Found</h3>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {history.map((record) => (
                      <div 
                        key={record.id}
                        className="bg-white p-5 rounded-[2rem] border border-slate-100 flex gap-5 items-center group hover:border-primary transition-all cursor-pointer shadow-sm hover:shadow-xl hover:shadow-slate-200/50"
                      >
                        <div className="w-14 h-14 bg-slate-100 rounded-2xl overflow-hidden shrink-0 relative border-2 border-white shadow-md">
                          <img 
                            src={record.imageUrl} 
                            alt={record.extractedData} 
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] font-black uppercase px-2 py-0.5 bg-primary text-white rounded-full tracking-widest">
                              {record.type}
                            </span>
                            <span className="text-[8px] font-bold uppercase px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full truncate max-w-[80px]">
                              ID: {record.userId.slice(0, 6)}
                            </span>
                          </div>
                          <h3 className="text-xs font-black uppercase tracking-widest truncate text-slate-900">{record.extractedData}</h3>
                          <div className="flex items-center gap-2 text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span className="text-[9px] font-bold uppercase tracking-wider">
                              {new Date(record.scannedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-200 group-hover:text-primary transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : adminSubView === 'reports' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-black uppercase tracking-tight">Daily Fuel Report</h3>
                  <p className="text-slate-500 text-sm">Summary of fuel dispensed in the last 24 hours.</p>
                  <button className="w-full py-3 bg-primary text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20">View Report</button>
                </div>
                <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-4">
                  <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
                    <Activity className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-black uppercase tracking-tight">System Activity</h3>
                  <p className="text-slate-500 text-sm">Real-time log of all terminal operations.</p>
                  <button className="w-full py-3 bg-primary text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20">View Logs</button>
                </div>
              </div>
            ) : adminSubView === 'pricing' ? (
              <div className="max-w-2xl bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-600">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black uppercase tracking-tight">Fuel Pricing</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Octane 95</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        value={fuelPrices.octane} 
                        onChange={(e) => setFuelPrices({ ...fuelPrices, octane: e.target.value })}
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-black text-right focus:outline-none focus:border-primary w-32" 
                      />
                      <span className="text-[10px] font-black text-slate-400">BDT/L</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Diesel</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        value={fuelPrices.diesel} 
                        onChange={(e) => setFuelPrices({ ...fuelPrices, diesel: e.target.value })}
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-black text-right focus:outline-none focus:border-primary w-32" 
                      />
                      <span className="text-[10px] font-black text-slate-400">BDT/L</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => alert("Pricing updated successfully!")}
                    className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95"
                  >
                    Update Pricing
                  </button>
                </div>
              </div>
            ) : adminSubView === 'quota' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
                      <Database className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-black uppercase tracking-tight">Quota Management</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 tracking-widest">
                        <span>Monthly Allocation</span>
                        <span>{quotas.used}L / {quotas.total}L</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-500" 
                          style={{ width: `${(quotas.used / quotas.total) * 100}%` }} 
                        />
                      </div>
                    </div>
                    <button 
                      onClick={() => setQuotas({ ...quotas, total: quotas.total + 10 })}
                      className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl shadow-primary/20 transition-all active:scale-95"
                    >
                      Increase Total Quota
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-2xl bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-primary">
                    <Settings className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black uppercase tracking-tight">System Settings</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Terminal ID</span>
                    <span className="font-black text-slate-900">PUMP-001-DHAKA</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Auto-Sync</span>
                    <span className="font-black text-green-600">ENABLED</span>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">My Scan History</h2>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{history.length} Records</span>
            </div>

            {historyLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-slate-400 font-medium">Loading records...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center space-y-4 border border-slate-100">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto">
                  <LayoutGrid className="w-8 h-8 text-slate-200" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">No records found</h3>
                <p className="text-slate-500 max-w-xs mx-auto">Start scanning items to see them appear here.</p>
                <button 
                  onClick={() => setView('scan')}
                  className="px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg shadow-primary/20"
                >
                  Go to Scanner
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {history.map((record) => (
                  <div 
                    key={record.id}
                    className="bg-white p-4 rounded-3xl border border-slate-100 flex gap-4 items-center group hover:border-primary transition-all cursor-pointer shadow-sm hover:shadow-xl hover:shadow-slate-200/50"
                  >
                    <div className="w-12 h-12 bg-slate-100 rounded-full overflow-hidden shrink-0 relative border-2 border-white shadow-sm">
                      <img 
                        src={record.imageUrl} 
                        alt={record.extractedData} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                          {record.type}
                        </span>
                      </div>
                      <h3 className="text-sm font-black uppercase tracking-widest truncate mt-1 text-slate-900">{record.extractedData}</h3>
                      <div className="flex items-center gap-2 text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span className="text-[10px] font-medium">
                          {new Date(record.scannedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-200 group-hover:text-primary transition-colors" />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Profile Detail Modal */}
      {selectedProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl rounded-[40px] overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
            <div className="p-8 pb-0 flex flex-col items-center text-center space-y-4 relative">
              <div className="absolute top-6 right-6 flex items-center gap-2">
                {!isEditingProfile ? (
                  <button 
                    onClick={() => {
                      setEditProfileData({ ...selectedProfile });
                      setIsEditingProfile(true);
                    }}
                    className="w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-500 transition-all active:scale-90"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setIsEditingProfile(false);
                      setEditProfileData(null);
                    }}
                    className="w-10 h-10 bg-red-50 hover:bg-red-100 rounded-full flex items-center justify-center text-red-500 transition-all active:scale-90"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={() => {
                    setSelectedProfile(null);
                    setIsEditingProfile(false);
                    setEditProfileData(null);
                  }}
                  className="w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-500 transition-all active:scale-90"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="relative group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-xl ring-1 ring-slate-100">
                  <img 
                    src={selectedProfile.faceImageUrl} 
                    alt={selectedProfile.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <div className="space-y-1 w-full max-w-md mx-auto">
                {isEditingProfile && editProfileData ? (
                  <div className="space-y-4">
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest ml-4">Full Name</label>
                      <input 
                        type="text"
                        value={editProfileData.name}
                        onChange={(e) => setEditProfileData({ ...editProfileData, name: e.target.value })}
                        className="w-full text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-3 focus:outline-none focus:border-primary transition-all"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight truncate max-w-[250px] mx-auto">
                      {selectedProfile.name}
                    </h3>
                    <div className="flex items-center justify-center gap-1.5 text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        Created {new Date(selectedProfile.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </>
                )}
                {!isEditingProfile && (
                  <button 
                    onClick={() => downloadImage(selectedProfile.faceImageUrl, `face_${selectedProfile.name.replace(/\s+/g, '_')}.jpg`)}
                    className="mt-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 text-[10px] font-bold uppercase tracking-widest mx-auto"
                  >
                    <Download className="w-3 h-3" />
                    Download Photo
                  </button>
                )}
              </div>
            </div>

            <div className="p-8 overflow-y-auto max-h-[calc(100vh-24rem)] space-y-8">
              {/* Scanned Documents Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Scanned Documents</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Plate */}
                  {(selectedProfile.plateImageUrl || isEditingProfile) && (
                    <div className="bg-slate-50 rounded-[2.5rem] p-5 border border-slate-100 space-y-4 flex flex-col">
                      {selectedProfile.plateImageUrl && (
                        <div className="relative aspect-video rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-sm">
                          <img src={selectedProfile.plateImageUrl} className="w-full h-full object-cover" alt="Plate Scan" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plate Number</p>
                        {isEditingProfile && editProfileData ? (
                          <input 
                            type="text"
                            value={editProfileData.plateNumber || ''}
                            onChange={(e) => setEditProfileData({ ...editProfileData, plateNumber: e.target.value.toUpperCase() })}
                            className="w-full text-sm font-black uppercase bg-white border border-slate-200 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:border-primary"
                            placeholder="Enter Plate"
                          />
                        ) : (
                          <p className="text-base font-black text-slate-900 truncate uppercase">{selectedProfile.plateNumber}</p>
                        )}
                      </div>
                      {!isEditingProfile && selectedProfile.plateImageUrl && (
                        <button 
                          onClick={() => downloadImage(selectedProfile.plateImageUrl!, `plate_${selectedProfile.plateNumber}.jpg`)}
                          className="w-full py-3 bg-primary text-white rounded-2xl shadow-md flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-primary/90 font-bold text-xs uppercase tracking-widest"
                        >
                          <Download className="w-4 h-4" />
                          Download Plate
                        </button>
                      )}
                    </div>
                  )}

                  {/* License */}
                  {(selectedProfile.licenseImageUrl || isEditingProfile) && (
                    <div className="bg-slate-50 rounded-[2.5rem] p-5 border border-slate-100 space-y-4 flex flex-col">
                      {selectedProfile.licenseImageUrl && (
                        <div className="relative aspect-video rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-sm">
                          <img src={selectedProfile.licenseImageUrl} className="w-full h-full object-cover" alt="License Scan" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">License Number</p>
                        {isEditingProfile && editProfileData ? (
                          <div className="space-y-2 mt-1">
                            <input 
                              type="text"
                              value={editProfileData.licenseNumber || ''}
                              onChange={(e) => setEditProfileData({ ...editProfileData, licenseNumber: e.target.value.toUpperCase() })}
                              className="w-full text-sm font-black uppercase bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                              placeholder="License No"
                            />
                            <input 
                              type="text"
                              value={editProfileData.licenseName || ''}
                              onChange={(e) => setEditProfileData({ ...editProfileData, licenseName: e.target.value })}
                              className="w-full text-[10px] font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                              placeholder="Full Name on License"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-base font-black text-slate-900 truncate uppercase">{selectedProfile.licenseNumber}</p>
                            {selectedProfile.licenseName && <p className="text-[10px] font-bold text-slate-500 uppercase truncate mt-0.5">{selectedProfile.licenseName}</p>}
                          </>
                        )}
                      </div>
                      {!isEditingProfile && selectedProfile.licenseImageUrl && (
                        <button 
                          onClick={() => downloadImage(selectedProfile.licenseImageUrl!, `license_${selectedProfile.licenseNumber}.jpg`)}
                          className="w-full py-3 bg-primary text-white rounded-2xl shadow-md flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-primary/90 font-bold text-xs uppercase tracking-widest"
                        >
                          <Download className="w-4 h-4" />
                          Download License
                        </button>
                      )}
                    </div>
                  )}

                  {/* NID */}
                  {(selectedProfile.nidImageUrl || isEditingProfile) && (
                    <div className="bg-slate-50 rounded-[2.5rem] p-5 border border-slate-100 space-y-4 flex flex-col">
                      {selectedProfile.nidImageUrl && (
                        <div className="relative aspect-video rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-sm">
                          <img src={selectedProfile.nidImageUrl} className="w-full h-full object-cover" alt="NID Scan" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">NID Number</p>
                        {isEditingProfile && editProfileData ? (
                          <div className="space-y-2 mt-1">
                            <input 
                              type="text"
                              value={editProfileData.nidNumber || ''}
                              onChange={(e) => setEditProfileData({ ...editProfileData, nidNumber: e.target.value.toUpperCase() })}
                              className="w-full text-sm font-black uppercase bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                              placeholder="NID No"
                            />
                            <input 
                              type="text"
                              value={editProfileData.nidName || ''}
                              onChange={(e) => setEditProfileData({ ...editProfileData, nidName: e.target.value })}
                              className="w-full text-[10px] font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                              placeholder="Full Name on NID"
                            />
                            <input 
                              type="text"
                              value={editProfileData.nidAge || ''}
                              onChange={(e) => setEditProfileData({ ...editProfileData, nidAge: e.target.value })}
                              className="w-full text-[10px] font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                              placeholder="Age"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-base font-black text-slate-900 truncate uppercase">{selectedProfile.nidNumber}</p>
                            {selectedProfile.nidName && <p className="text-[10px] font-bold text-slate-500 uppercase truncate mt-0.5">{selectedProfile.nidName}</p>}
                          </>
                        )}
                      </div>
                      {!isEditingProfile && selectedProfile.nidImageUrl && (
                        <button 
                          onClick={() => downloadImage(selectedProfile.nidImageUrl!, `nid_${selectedProfile.nidNumber}.jpg`)}
                          className="w-full py-3 bg-primary text-white rounded-2xl shadow-md flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-primary/90 font-bold text-xs uppercase tracking-widest"
                        >
                          <Download className="w-4 h-4" />
                          Download NID
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Address & NID Back Section */}
              {(selectedProfile.address || selectedProfile.nidBackImageUrl || isEditingProfile) && (
                <div className="pt-6 border-t border-slate-100 text-left space-y-4">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                    <Search className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Address & NID Back</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      {isEditingProfile && editProfileData ? (
                        <textarea 
                          value={editProfileData.address || ''}
                          onChange={(e) => setEditProfileData({ ...editProfileData, address: e.target.value })}
                          placeholder="Enter Address"
                          className="w-full text-sm bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 focus:outline-none focus:border-primary transition-all min-h-[80px]"
                        />
                      ) : (
                        <p className="text-sm font-medium text-slate-700 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          {selectedProfile.address || 'No address recorded'}
                        </p>
                      )}
                    </div>

                    {(selectedProfile.nidBackImageUrl || isEditingProfile) && (
                      <div className="bg-slate-50 rounded-[2.5rem] p-5 border border-slate-100 space-y-4 flex flex-col">
                        {selectedProfile.nidBackImageUrl && (
                          <div className="relative aspect-video rounded-[1.5rem] overflow-hidden border border-slate-200 shadow-sm">
                            <img src={selectedProfile.nidBackImageUrl} className="w-full h-full object-cover" alt="NID Back Scan" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">NID Back Image</p>
                          <p className="text-xs font-bold text-slate-500 uppercase truncate mt-0.5">
                            {selectedProfile.nidBackImageUrl ? 'Captured' : 'Not Captured'}
                          </p>
                        </div>
                        {!isEditingProfile && selectedProfile.nidBackImageUrl && (
                          <button 
                            onClick={() => downloadImage(selectedProfile.nidBackImageUrl!, `nid_back_${selectedProfile.nidNumber}.jpg`)}
                            className="w-full py-3 bg-primary text-white rounded-2xl shadow-md flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-primary/90 font-bold text-xs uppercase tracking-widest"
                          >
                            <Download className="w-4 h-4" />
                            Download Back
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata Section */}
              {selectedProfile.metadata && (
                <div className="pt-6 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-slate-400 mb-4">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Verification Status</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {selectedProfile.metadata.nameMatch !== null && (
                      <div className={cn(
                        "px-4 py-2 rounded-2xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-2",
                        selectedProfile.metadata.nameMatch ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {selectedProfile.metadata.nameMatch ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        Name Match: {selectedProfile.metadata.nameMatch ? 'Verified' : 'Mismatched'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Save Button for Editing */}
              {isEditingProfile && (
                <div className="pt-8 flex gap-4">
                  <button 
                    onClick={handleUpdateProfile}
                    disabled={loading}
                    className="flex-1 py-4 bg-primary hover:bg-primary/90 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-primary/20"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                  <button 
                    onClick={() => {
                      setIsEditingProfile(false);
                      setEditProfileData(null);
                    }}
                    className="px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Scan Modal */}
      {subScanModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center text-white">
                  {subScanModal === 'PLATE' ? <Car className="w-5 h-5" /> : 
                   subScanModal === 'LICENSE' ? <CreditCard className="w-5 h-5" /> : 
                   subScanModal === 'NID' ? <IdCard className="w-5 h-5" /> :
                   <Search className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-black uppercase tracking-widest text-slate-900">
                    {subScanModal === 'NID_BACK' ? 'Scan NID Back' : `Scan ${subScanModal}`}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {subScanModal === 'NID_BACK' ? 'Align NID back for address extraction' : 'Align item in the frame'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSubScanModal(null)}
                className="w-10 h-10 rounded-2xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div 
              className="relative aspect-[4/3] bg-slate-900 overflow-hidden cursor-pointer"
              onClick={() => {
                if (!loading) {
                  scanSubItem(subScanModal).then(() => setSubScanModal(null));
                }
              }}
            >
              <Webcam
                {...({
                  audio: false,
                  ref: subWebcamRef,
                  screenshotFormat: "image/jpeg",
                  videoConstraints: {
                    width: 1280,
                    height: 720,
                    facingMode: "environment"
                  },
                  className: "w-full h-full object-cover",
                  screenshotQuality: 1
                } as any)}
              />
              <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none">
                <div className="w-full h-full border-2 border-white/50 rounded-2xl border-dashed" />
              </div>
              
              {loading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-white z-10">
                  <Loader2 className="w-10 h-10 animate-spin" />
                  <p className="font-bold uppercase tracking-widest text-sm">
                    {subScanModal === 'NID_BACK' ? 'Extracting Address...' : `Processing ${subScanModal}...`}
                  </p>
                </div>
              )}
            </div>

            <div className="p-6">
              <button
                onClick={async () => {
                  await scanSubItem(subScanModal);
                  setSubScanModal(null);
                }}
                disabled={loading}
                className="w-full py-5 bg-primary hover:bg-primary/90 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl shadow-primary/20"
              >
                <Camera className="w-6 h-6" />
                {subScanModal === 'NID_BACK' ? 'Capture Address' : 'Capture & Extract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan Result Modal (Error/Success) */}
      {scanErrorModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setScanErrorModal(null)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl shadow-black/20 overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center mx-auto",
                scanErrorModal.title === 'Success' ? "bg-green-50" : "bg-red-50"
              )}>
                <div className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center",
                  scanErrorModal.title === 'Success' ? "bg-green-100" : "bg-red-100"
                )}>
                  {scanErrorModal.title === 'Success' ? (
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">{scanErrorModal.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  {scanErrorModal.message}
                </p>
              </div>

              <button 
                onClick={() => setScanErrorModal(null)}
                className={cn(
                  "w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 shadow-xl",
                  scanErrorModal.title === 'Success' 
                    ? "bg-green-600 hover:bg-green-700 text-white shadow-green-900/20" 
                    : "bg-primary hover:bg-primary/90 text-white shadow-primary/20"
                )}
              >
                {scanErrorModal.title === 'Success' ? 'Great!' : 'Try Again'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styles for scan animation */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          100% { top: 100%; }
        }
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(255, 255, 255, 0.2); transform: scale(1); }
          50% { border-color: rgba(255, 255, 255, 0.5); transform: scale(1.01); }
        }
        @keyframes corner-tl {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-4px, -4px); }
        }
        @keyframes corner-tr {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(4px, -4px); }
        }
        @keyframes corner-bl {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-4px, 4px); }
        }
        @keyframes corner-br {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(4px, 4px); }
        }
      `}</style>
    </div>
  );
}
