"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "../../utils/supabase"; 
import { useRouter } from "next/navigation";

const SHOW_INCOMPLETE_SCAN_BUTTON = 1; // 1 = show scan button, 0 = hide scan button
const AUTO_SCAN_INCOMPLETE_ON_LOAD = 1; // 1 = scan automatically when page opens, 0 = do not auto-scan
// ============================================================================
// INTERFACES & CONSTANTS
// ============================================================================
interface Ingredient {
  name: string;
  quantity: number | string;
  unit: string;
  notes?: string;
}

interface Step {
  text: string;
  audio_url?: string;
}

interface Recipe {
  id?: string;
  title: string;
  description: string;
  servings: number | string;
  prep_min: number;
  cook_min: number;
  categories: string[];
  ingredients: Ingredient[];
  steps: Step[];
  media_urls: {
    main_image?: string;
  };
}

const SERVINGS_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);
const QUANTITY_OPTIONS = [
  0.125, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000
];
const UNIT_OPTIONS = ['g', 'ml', 'tsp', 'tbsp', 'cup', 'lb', 'oz', 'whole', 'pinch', 'clove', 'can', 'slice'];


const INCOMPLETE_CATEGORY = "Incomplete";
const UNCATEGORIZED_CATEGORY = "Uncategorized";
const NEEDS_PHOTO_CATEGORY = "Needs Photo";

const SYSTEM_CATEGORIES = [
  INCOMPLETE_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  NEEDS_PHOTO_CATEGORY
];

const recipeHasIngredients = (recipe: Pick<Recipe, 'ingredients'>) => {
  return (recipe.ingredients || []).some(ing => ing.name?.trim() !== '');
};

const recipeHasInstructions = (recipe: Pick<Recipe, 'steps'>) => {
  return (recipe.steps || []).some(step => step.text?.trim() !== '' || !!step.audio_url);
};

const recipeHasMainPhoto = (recipe: Pick<Recipe, 'media_urls'>) => {
  return !!recipe.media_urls?.main_image;
};

const recipeHasRealCategory = (recipe: Pick<Recipe, 'categories'>) => {
  return (recipe.categories || []).some(cat => !SYSTEM_CATEGORIES.includes(cat));
};

const getCategoriesWithIncompleteStatus = (recipe: Pick<Recipe, 'categories' | 'ingredients' | 'steps' | 'media_urls'>) => {
  const currentCategories = recipe.categories || [];
  const cleanCategories = currentCategories.filter(cat => !SYSTEM_CATEGORIES.includes(cat));

  const hasIngredients = recipeHasIngredients(recipe);
  const hasInstructions = recipeHasInstructions(recipe);
  const hasPhoto = recipeHasMainPhoto(recipe);
  const hasRealCategory = cleanCategories.length > 0;

  const updatedCategories = [...cleanCategories];

  if (!hasPhoto) {
    updatedCategories.push(NEEDS_PHOTO_CATEGORY);
  }

  if (!hasRealCategory) {
    updatedCategories.push(UNCATEGORIZED_CATEGORY);
  }

  if (!hasIngredients || !hasInstructions || !hasPhoto || !hasRealCategory) {
    updatedCategories.push(INCOMPLETE_CATEGORY);
  }

  return updatedCategories;
};

// ============================================================================
// CONVERTER CONSTANTS & MATH ENGINETH ENGINE
// ============================================================================
const KITCHEN_CONVERSIONS = {
  volume: { ml: 1, tsp: 4.92892, tbsp: 14.7868, 'fl oz': 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, l: 1000, gal: 3785.41 },
  weight: { g: 1, oz: 28.3495, lb: 453.592, kg: 1000 },
  temperature: { C: 'temp', F: 'temp' }
};

const CONVERTER_OPTIONS = [
  ...Object.keys(KITCHEN_CONVERSIONS.volume),
  ...Object.keys(KITCHEN_CONVERSIONS.weight),
  ...Object.keys(KITCHEN_CONVERSIONS.temperature)
];

const doConversion = (amount: number, from: string, to: string): string | null => {
  if (from === to) return amount.toString();
  
  if (from === 'C' && to === 'F') return ((amount * 9/5) + 32).toFixed(1);
  if (from === 'F' && to === 'C') return ((amount - 32) * 5/9).toFixed(1);
  
  if (from in KITCHEN_CONVERSIONS.volume && to in KITCHEN_CONVERSIONS.volume) {
    const inMl = amount * KITCHEN_CONVERSIONS.volume[from as keyof typeof KITCHEN_CONVERSIONS.volume];
    const result = inMl / KITCHEN_CONVERSIONS.volume[to as keyof typeof KITCHEN_CONVERSIONS.volume];
    return result < 10 ? result.toFixed(2) : result.toFixed(1);
  }
  
  if (from in KITCHEN_CONVERSIONS.weight && to in KITCHEN_CONVERSIONS.weight) {
    const inG = amount * KITCHEN_CONVERSIONS.weight[from as keyof typeof KITCHEN_CONVERSIONS.weight];
    const result = inG / KITCHEN_CONVERSIONS.weight[to as keyof typeof KITCHEN_CONVERSIONS.weight];
    return result < 10 ? result.toFixed(2) : result.toFixed(1);
  }
  
  return null;
};

// --- NEW FRACTION FORMATTER (UNICODE NATIVE) ---
const formatFraction = (val: number | string) => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return val;

  const whole = Math.floor(num);
  const decimal = num - whole;

  let fraction = "";
  const eps = 0.02; // Tolerance for decimals like 0.33333

  if (decimal < eps) return whole.toString();
  
  if (Math.abs(decimal - 0.125) < eps) fraction = "⅛";
  else if (Math.abs(decimal - 0.25) < eps) fraction = "¼";
  else if (Math.abs(decimal - 0.33) < eps) fraction = "⅓";
  else if (Math.abs(decimal - 0.5) < eps) fraction = "½";
  else if (Math.abs(decimal - 0.66) < eps) fraction = "⅔";
  else if (Math.abs(decimal - 0.75) < eps) fraction = "¾";

  if (!fraction) return num.toString();
  return whole > 0 ? `${whole} ${fraction}` : fraction;
};

// ============================================================================
// HELPER COMPONENT: INLINE AUDIO RECORDER
// ============================================================================
const AudioRecorder = ({ onUploadSuccess }: { onUploadSuccess: (url: string) => void }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleUpload(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleUpload = async (blob: Blob) => {
    setIsUploading(true);
    const fileName = `audio_${Date.now()}.webm`;
    
    const { data, error } = await supabase.storage.from('mamadee_media').upload(`audio/${fileName}`, blob);

    if (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload audio: ${error.message}`);
    } else if (data) {
      const { data: publicData } = supabase.storage.from('mamadee_media').getPublicUrl(`audio/${fileName}`);
      onUploadSuccess(publicData.publicUrl);
    }
    setIsUploading(false);
  };

  if (isUploading) return <span className="text-sm text-[#C53636] animate-pulse font-bold">Uploading...</span>;

  return (
    <button
      onClick={(e) => { e.preventDefault(); isRecording ? stopRecording() : startRecording(); }}
      className={`px-3 py-2 text-xs md:text-sm font-bold rounded-md transition-colors ${
        isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-[#333] hover:bg-[#444] text-gray-300 border border-[#555]'
      }`}
    >
      {isRecording ? '🛑 Stop & Save' : '🎙️ Record Audio'}
    </button>
  );
};

// ============================================================================
// MAIN APPLICATION
// ============================================================================
export default function MamaDeeApp() {
  const router = useRouter();
  
  // Added 'converter' to the view types
  const [view, setView] = useState<'library' | 'cook' | 'edit' | 'converter'>('library');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);

  // New Converter States
  const [convInput, setConvInput] = useState<{val: number | string, source: 'top' | 'bottom'}>({ val: 1, source: 'top' });
  const [convFrom, setConvFrom] = useState<string>("cup");
  const [convTo, setConvTo] = useState<string>("ml");
  
  // State for the 3-dot menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Recipe>({
    title: '', description: '', servings: 1, prep_min: 0, cook_min: 0, categories: [], ingredients: [], steps: [], media_urls: {}
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("");
  const [newCategoryInput, setNewCategoryInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [quickScanning, setQuickScanning] = useState(false);

  // --- SETTINGS & AUTH STATE ---
  const [appPassword, setAppPassword] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState<{ type: string, payload?: any } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [catEditName, setCatEditName] = useState("");
  const [catOldName, setCatOldName] = useState("");

  // --- AI FEATURE STATE ---
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInputMode, setAiInputMode] = useState<'text' | 'url' | 'upload' | 'camera'>('url');
  const [aiInputText, setAiInputText] = useState("");
  const [aiProcessing, setAiProcessing] = useState(false);

  // --- NEW: VOICE NAVIGATION & WAKELOCK STATE ---
  const [isListening, setIsListening] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const recognitionRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  const libraryScrollYRef = useRef<number | null>(null);
  const libraryRestoreRecipeIdRef = useRef<string | null>(null);
  
  // Refs to prevent stale closures in the voice event listener
  const isListeningRef = useRef(false);
  const activeStepRef = useRef(-1);
  const recipeRef = useRef(selectedRecipe);

  useEffect(() => {
    isListeningRef.current = isListening;
    activeStepRef.current = activeStep;
    recipeRef.current = selectedRecipe;
  }, [isListening, activeStep, selectedRecipe]);

  useEffect(() => {
    // Initialize Speech Recognition once on mount
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;

        recognition.onresult = (event: any) => {
          const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
          console.log("Heard:", transcript); // Helpful for debugging

          if (transcript.includes("turtle")) {
            
            // --- TEXT-TO-SPEECH HELPER ---
            const speakOutLoud = (text: string) => {
              if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); 
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 0.9; 
                window.speechSynthesis.speak(utterance);
              }
            };

            // --- FIXED: NOW HANDLES DIGITS AND WRITTEN WORDS ---
            const stepMatch = transcript.match(/step\s+([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/);

            if (stepMatch) {
              const matchedVal = stepMatch[1];
              let stepNumber = parseInt(matchedVal, 10);
              
              // If it's a word like "three", convert it to the number 3
              if (isNaN(stepNumber)) {
                const wordsToNumbers: Record<string, number> = { 
                  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 
                  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, 
                  eighteen: 18, nineteen: 19, twenty: 20 
                };
                stepNumber = wordsToNumbers[matchedVal];
              }

              const targetIndex = stepNumber - 1; // Convert to 0-based array index
              
              if (recipeRef.current?.steps && targetIndex >= 0 && targetIndex < recipeRef.current.steps.length) {
                setActiveStep(targetIndex);
                document.getElementById(`recipe-step-${targetIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                speakOutLoud(`Step ${stepNumber}. ${recipeRef.current.steps[targetIndex].text}`);
              } else {
                speakOutLoud(`I couldn't find step ${stepNumber}.`);
              }
            } 
            else if (transcript.includes("next") || transcript.includes("forward")) {
              const maxSteps = recipeRef.current?.steps?.length || 1;
              const nextStep = Math.min(activeStepRef.current + 1, maxSteps - 1);
              setActiveStep(nextStep);
              document.getElementById(`recipe-step-${nextStep}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              if (recipeRef.current?.steps?.[nextStep]) {
                speakOutLoud(`Step ${nextStep + 1}. ${recipeRef.current.steps[nextStep].text}`);
              }
              
            } else if (transcript.includes("back") || transcript.includes("previous")) {
              const prevStep = Math.max(activeStepRef.current - 1, 0);
              setActiveStep(prevStep);
              document.getElementById(`recipe-step-${prevStep}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              if (recipeRef.current?.steps?.[prevStep]) {
                speakOutLoud(`Step ${prevStep + 1}. ${recipeRef.current.steps[prevStep].text}`);
              }
              
            } 
            // --- FIXED: REMOVED "READ" SO IT DOESN'T FIGHT THE OTHER COMMANDS ---
            else if (transcript.includes("top") || transcript.includes("ingredient") || transcript.includes("ingredients")) {
              setActiveStep(-1);
              window.scrollTo({ top: 0, behavior: 'smooth' });
              speakOutLoud("Back to the top. Ingredients are on screen.");
            }
          }
        };

        // Mobile browsers kill the mic when quiet; this auto-restarts it if Hands-Free mode is toggled on.
        recognition.onend = () => {
          if (isListeningRef.current) {
            try { recognition.start(); } catch(e){}
          }
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  const toggleVoiceMode = async () => {
    if (!recognitionRef.current) {
      alert("Your browser does not support voice recognition. Please use Safari or Chrome.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      try { recognitionRef.current.stop(); } catch(e){}
      if ('speechSynthesis' in window) window.speechSynthesis.cancel(); 
      if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
    } else {
      setIsListening(true);
      setActiveStep(-1); // Leave step un-highlighted until she asks for one
      try { recognitionRef.current.start(); } catch(e){}
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch (e) { console.error("WakeLock failed:", e); }
      
      // Just confirm it is on, don't read the recipe yet
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const startUtterance = new SpeechSynthesisUtterance("Hands free mode activated. Waiting for commands.");
        startUtterance.rate = 0.9;
        window.speechSynthesis.speak(startUtterance);
      }
    }
  };
  useEffect(() => {
    setAppPassword(localStorage.getItem('mamadee_password') || "");
    fetchRecipes(AUTO_SCAN_INCOMPLETE_ON_LOAD === 1);
  }, []);



  const fetchRecipes = async (runIncompleteScan = false) => {
    setLoading(true);
    const { data, error } = await supabase.from('mamadee').select('*').order('title', { ascending: true });
    
    if (!error) {
      const fetchedRecipes = data as Recipe[] || [];
      setRecipes(fetchedRecipes);

      // --- DEEP LINKING LOGIC ---
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const recipeId = urlParams.get('id');
        
        if (recipeId) {
          // FIX: Convert both to Strings! Prevents Database (Number) vs URL (String) mismatch
          const targetRecipe = fetchedRecipes.find(r => String(r.id) === String(recipeId));
          
          if (targetRecipe) {
            setSelectedRecipe(targetRecipe);
            setView('cook');
            
            // Clean up the URL bar so it just says your normal address again
            // We use a tiny timeout to ensure Next.js has fully loaded the view first
            setTimeout(() => {
              window.history.replaceState(null, '', window.location.pathname);
            }, 100);
          }
        }
      }

      setLoading(false);

      if (runIncompleteScan) {
        await executeQuickScanIncomplete(fetchedRecipes, true);
      }

      return;
    }

    setLoading(false);
  };

  const allCategories = Array.from(new Set(recipes.flatMap(r => r.categories || []))).sort();

  const filteredRecipes = recipes.filter(r => {
    const matchesSearch = r.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategoryFilter === "" || (r.categories || []).includes(selectedCategoryFilter);
    return matchesSearch && matchesCategory;
  });

  const incompleteRecipeCount = recipes.filter(r => (r.categories || []).includes(INCOMPLETE_CATEGORY)).length;

  useEffect(() => {
    if (view !== 'library') return;

    const savedRecipeId = libraryRestoreRecipeIdRef.current;
    const savedY = libraryScrollYRef.current;

    if (!savedRecipeId && savedY === null) return;

    const restoreScroll = () => {
      if (savedRecipeId) {
        const card = document.getElementById(`recipe-card-${savedRecipeId}`);
        if (card) {
          card.scrollIntoView({ behavior: 'auto', block: 'start' });

          window.scrollBy({
            top: -16,
            left: 0,
            behavior: 'auto'
          });

          return;
        }
      }

      if (savedY !== null) {
        window.scrollTo({ top: savedY, behavior: 'auto' });
      }
    };

    requestAnimationFrame(() => {
      restoreScroll();

      setTimeout(restoreScroll, 50);
      setTimeout(restoreScroll, 150);
      setTimeout(restoreScroll, 300);
    });
  }, [view, recipes.length, filteredRecipes.length]);

  // ============================================================================
  // AUTH & SETTINGS LOGIC
  // ============================================================================
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === appPassword) {
      setShowPasswordModal(false);
      if (pendingAction) executeAction(pendingAction.type, pendingAction.payload);
      setPendingAction(null);
    } else {
      alert("Incorrect password");
    }
  };

  const requireAuth = (actionType: string, payload?: any) => {
    if (!appPassword) {
      executeAction(actionType, payload);
    } else {
      setPendingAction({ type: actionType, payload });
      setPasswordInput("");
      setShowPasswordModal(true);
    }
  };

  const handleSavePassword = (newPass: string) => {
    if (newPass === "") {
      localStorage.removeItem('mamadee_password');
    } else {
      localStorage.setItem('mamadee_password', newPass);
    }
    setAppPassword(newPass);
    alert(newPass === "" ? "Password removed!" : "Password updated successfully!");
  };

  const handleUpdateCategory = async (oldCat: string, newCat: string) => {
    setLoading(true);
    // Find all recipes containing the old category
    const recipesToUpdate = recipes.filter(r => r.categories?.includes(oldCat));
    
    // Update them one by one in Supabase
    for (const r of recipesToUpdate) {
      const updatedCategories = newCat 
        ? r.categories.map(c => c === oldCat ? newCat : c) // Rename
        : r.categories.filter(c => c !== oldCat);          // Delete
      await supabase.from('mamadee').update({ categories: updatedCategories }).eq('id', r.id);
    }
    
    setCatOldName("");
    setCatEditName("");
    await fetchRecipes(); // Refresh library
  };

  // ============================================================================
  // ACTION WRAPPERS (Intercepted by Auth)
  // ============================================================================
  const handleAddRecipe = () => requireAuth('add');
  const handleAiImportBtn = () => requireAuth('ai_import');
  const handleQuickScanIncomplete = () => requireAuth('quick_scan_incomplete');
  const handleEditRecipe = (recipe: Recipe) => requireAuth('edit', recipe);
  
  const handleDuplicateRecipe = (e: React.MouseEvent, recipe: Recipe) => {
    e.stopPropagation();
    setOpenMenuId(null);
    requireAuth('duplicate', recipe);
  };

  const handleDeleteRecipe = (e: React.MouseEvent, recipe: Recipe) => {
    e.stopPropagation();
    setOpenMenuId(null);
    requireAuth('delete', recipe);
  };

  const executeAction = async (actionType: string, payload?: any) => {
    if (actionType === 'settings') {
      setShowSettings(true);
    } else if (actionType === 'add') {
      setFormData({ 
        title: '', description: '', servings: 1, prep_min: 0, cook_min: 0, categories: [], media_urls: {},
        ingredients: [{ name: '', quantity: 1, unit: '' }], 
        steps: [{ text: '' }] 
      });
      setSelectedRecipe(null);
      setView('edit');
    } else if (actionType === 'ai_import') {
      setAiInputText("");
      setAiInputMode("url");
      setShowAiModal(true);
    } else if (actionType === 'quick_scan_incomplete') {
      await executeQuickScanIncomplete();
    } else if (actionType === 'edit') {
      setFormData({ 
        ...payload, 
        media_urls: payload.media_urls || {},
        categories: payload.categories || [],
        ingredients: payload.ingredients?.length > 0 ? payload.ingredients : [{ name: '', quantity: 1, unit: '' }],
        steps: payload.steps?.length > 0 ? payload.steps : [{ text: '' }]
      });
      setView('edit');
    } else if (actionType === 'duplicate') {
      await executeDuplicate(payload);
    } else if (actionType === 'delete') {
      await executeDelete(payload);
    }
  };

  // ============================================================================
  // CORE EXECUTORS
  // ============================================================================
  const executeQuickScanIncomplete = async (sourceRecipes: Recipe[] = recipes, automatic = false) => {
    setQuickScanning(true);
    if (!automatic) setLoading(true);

    let updatedCount = 0;
    let newlyMarkedIncompleteCount = 0;

    for (const recipe of sourceRecipes) {
      const updatedCategories = getCategoriesWithIncompleteStatus(recipe);
      const currentCategories = recipe.categories || [];
      const categoriesChanged = JSON.stringify([...currentCategories].sort()) !== JSON.stringify([...updatedCategories].sort());

      const wasIncomplete = currentCategories.includes(INCOMPLETE_CATEGORY);
      const isNowIncomplete = updatedCategories.includes(INCOMPLETE_CATEGORY);

      if (categoriesChanged) {
        const { error } = await supabase
          .from('mamadee')
          .update({ categories: updatedCategories })
          .eq('id', recipe.id);

        if (error) {
          console.error("Incomplete scan update error:", error);
        } else {
          updatedCount++;

          if (!wasIncomplete && isNowIncomplete) {
            newlyMarkedIncompleteCount++;
          }
        }
      }
    }

    await fetchRecipes(false);

    setQuickScanning(false);
    if (!automatic) setLoading(false);

    if (automatic) {
      if (newlyMarkedIncompleteCount === 1) {
        alert("1 recipe has been added to the incomplete list.");
      } else if (newlyMarkedIncompleteCount > 1) {
        alert(`${newlyMarkedIncompleteCount} recipes have been added to the incomplete list.`);
      }

      return;
    }

    alert(updatedCount === 1 ? "1 recipe category was updated." : `${updatedCount} recipe categories were updated.`);
  };

  
  const executeDuplicate = async (recipe: Recipe) => {
    setLoading(true);
    const { id, ...recipeWithoutId } = recipe; 
    const duplicatedRecipe = { ...recipeWithoutId, title: `${recipe.title} (Copy)` };
    const { error } = await supabase.from('mamadee').insert([duplicatedRecipe]);

    if (error) alert(`Failed to duplicate recipe: ${error.message}`);
    else fetchRecipes(); 
    
    setLoading(false);
  };

  const executeDelete = async (recipe: Recipe) => {
    const confirmDelete = window.confirm("Are you sure you want to permanently delete this recipe? This will also delete any attached photos and audio.");
    if (!confirmDelete) return;

    setLoading(true);
    const filesToDelete: string[] = [];
    
    const extractPath = (url: string) => {
      if (!url) return null;
      const marker = 'mamadee_media/';
      const index = url.indexOf(marker);
      if (index !== -1) return url.substring(index + marker.length);
      return null;
    };

    if (recipe.media_urls?.main_image) {
      const path = extractPath(recipe.media_urls.main_image);
      if (path) filesToDelete.push(path);
    }

    recipe.steps?.forEach(step => {
      if (step.audio_url) {
        const path = extractPath(step.audio_url);
        if (path) filesToDelete.push(path);
      }
    });

    if (filesToDelete.length > 0) {
      await supabase.storage.from('mamadee_media').remove(filesToDelete);
    }

    const { error: dbError } = await supabase.from('mamadee').delete().eq('id', recipe.id);
    
    if (dbError) alert(`Failed to delete recipe: ${dbError.message}`);
    else fetchRecipes(); 
    
    setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);

    if (formData.media_urls?.main_image) {
      const oldUrl = formData.media_urls.main_image;
      const marker = 'mamadee_media/';
      const index = oldUrl.indexOf(marker);
      
      if (index !== -1) {
        const oldPath = oldUrl.substring(index + marker.length);
        console.log("Attempting to delete replaced image from storage:", oldPath);
        
        const { error: removeError } = await supabase.storage.from('mamadee_media').remove([oldPath]);
        
        if (removeError) {
          console.error("Storage Deletion Error:", removeError);
        } else {
          console.log("Successfully deleted old image from storage.");
        }
      }
    }

    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `image_${Date.now()}_${sanitizedFileName}`;
    
    const { data, error } = await supabase.storage.from('mamadee_media').upload(`images/${fileName}`, file);

    if (error) {
      alert(`Failed to upload image: ${error.message}`);
    } else if (data) {
      const { data: publicData } = supabase.storage.from('mamadee_media').getPublicUrl(`images/${fileName}`);
      setFormData(prev => ({ ...prev, media_urls: { ...prev.media_urls, main_image: publicData.publicUrl } }));
    }
    setImageUploading(false);
  };

  const handleAddCategoryToForm = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    
    if (!formData.categories.includes(trimmed)) {
      setFormData(prev => ({ ...prev, categories: [...prev.categories, trimmed] }));
    }
    setNewCategoryInput(""); 
  };

  const handleRemoveCategoryFromForm = (catToRemove: string) => {
    setFormData(prev => ({ ...prev, categories: prev.categories.filter(c => c !== catToRemove) }));
  };

  const handleSaveRecipe = async () => {
    if (!formData.title) return alert("Recipe needs a title!");
    setSaving(true);

    const cleanedIngredients = formData.ingredients.filter(ing => ing.name.trim() !== '');
    const cleanedSteps = formData.steps.filter(step => step.text.trim() !== '' || !!step.audio_url);

    const cleanedFormData = {
      ...formData,
      ingredients: cleanedIngredients,
      steps: cleanedSteps,
      servings: typeof formData.servings === 'string' ? parseFloat(formData.servings) || 1 : formData.servings,
      categories: getCategoriesWithIncompleteStatus({
        ...formData,
        ingredients: cleanedIngredients,
        steps: cleanedSteps,
        media_urls: formData.media_urls || {}
      })
    };

    if (cleanedFormData.id) {
      await supabase.from('mamadee').update(cleanedFormData).eq('id', cleanedFormData.id);
    } else {
      await supabase.from('mamadee').insert([cleanedFormData]);
    }

    setSaving(false);
    setView('library');
    fetchRecipes(); 
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Mama Dee's Recipes",
          url: url,
        });
      } catch (err) {
        console.error("Error sharing:", err);
      }
    } else {
      navigator.clipboard.writeText(url);
      alert("Link copied to clipboard!");
    }
  };

  const handleShareRecipe = async (recipe: Recipe) => {
    // Build the specific URL for this recipe
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('id', String(recipe.id)); // FIX: Ensure ID is a string
    const shareUrl = url.toString();

    if (navigator.share) {
      try {
        await navigator.share({
          title: recipe.title,
          text: `Check out this recipe for ${recipe.title}!`,
          url: shareUrl,
        });
      } catch (err) {
        console.error("Error sharing:", err);
      }
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert("Recipe link copied to clipboard!");
    }
  };

  const processAiImport = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalContent = aiInputText;
    let apiType = aiInputMode as string;

    if (aiInputMode === 'upload' || aiInputMode === 'camera') {
      const inputId = aiInputMode === 'upload' ? 'ai-upload-input' : 'ai-camera-input';
      const fileInput = document.getElementById(inputId) as HTMLInputElement;
      const file = fileInput?.files?.[0];
      
      if (!file) return alert("Please select or take a photo first.");
      
      setAiProcessing(true);

      try {
        // Intercept and compress the image using HTML5 Canvas
        const compressedBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 1200; // Cap resolution for OCR
              const MAX_HEIGHT = 1200;
              let width = img.width;
              let height = img.height;

              // Maintain aspect ratio
              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, width, height);
              
              // Force output to JPEG at 80% quality. Fixes massive file sizes and HEIC compat.
              resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
            img.src = event.target?.result as string;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        finalContent = compressedBase64;
        apiType = 'image';
      } catch (err) {
        console.error("Image compression error:", err);
        alert("Failed to process the image. Please try another photo.");
        setAiProcessing(false);
        return;
      }
    }

    if (!finalContent.trim() && aiInputMode !== 'upload' && aiInputMode !== 'camera') return;
    
    setAiProcessing(true);
    try {
      const res = await fetch('/api/ai-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: apiType, content: finalContent })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setFormData({
          title: data.recipe.title || '', 
          description: data.recipe.description || '', 
          servings: data.recipe.servings || 1, 
          prep_min: data.recipe.prep_min || 0, 
          cook_min: data.recipe.cook_min || 0, 
          categories: data.recipe.categories || [], 
          media_urls: {},
          ingredients: data.recipe.ingredients?.length > 0 ? data.recipe.ingredients : [{ name: '', quantity: 1, unit: '' }],
          steps: data.recipe.steps?.length > 0 ? data.recipe.steps : [{ text: '' }]
        });
        
        setShowAiModal(false);
        setAiInputText("");
        setSelectedRecipe(null);
        setView('edit');
      } else {
        alert("AI parsing failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error connecting to AI service.");
    }
    setAiProcessing(false);
  };

  // ============================================================================
  // CONTENT RENDERER
  // ============================================================================
  const renderContent = () => {
    // ----------------------------------------------------------------------------
    // VIEW: EDIT / ADD MODE
    // ----------------------------------------------------------------------------
    if (view === 'edit') {
      return (
        <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-3 md:p-8 pb-24">
          <datalist id="servings-options">{SERVINGS_OPTIONS.map(num => <option key={num} value={num} />)}</datalist>
          <datalist id="qty-options">{QUANTITY_OPTIONS.map(num => <option key={num} value={num} />)}</datalist>
          <datalist id="unit-options">{UNIT_OPTIONS.map(unit => <option key={unit} value={unit} />)}</datalist>
          <datalist id="category-options">{allCategories.map(cat => <option key={cat} value={cat} />)}</datalist>

          <div className="flex justify-between items-center mb-6 border-b border-[#444] pb-4 sticky top-0 bg-[#1E1E1E] z-10">
            <button onClick={() => setView(selectedRecipe ? 'cook' : 'library')} className="text-gray-400 hover:text-white transition-colors font-bold text-sm md:text-base py-2">
              Cancel
            </button>
            <h2 className="text-xl md:text-2xl font-bold truncate px-2">{formData.id ? 'Edit Recipe' : 'New Recipe'}</h2>
            <button onClick={handleSaveRecipe} disabled={saving} className="bg-[#C53636] hover:bg-[#C95757] disabled:opacity-50 px-4 md:px-6 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="max-w-3xl mx-auto space-y-6">
            
            {/* NEW AI BUTTON PLACEMENT */}
            <button 
              onClick={(e) => { e.preventDefault(); handleAiImportBtn(); }} 
              className="w-full bg-[#C53636]/10 hover:bg-[#C53636]/20 text-[#C53636] border border-[#C53636]/30 py-3 md:py-4 rounded-xl font-bold transition-colors shadow-sm text-sm md:text-base flex items-center justify-center gap-2 mb-4"
            >
              <span className="text-xl">✨</span> Auto-fill recipe using AI
            </button>

            <div className="bg-[#2D2D2D] rounded-xl p-4 md:p-6 shadow-lg border border-[#444] space-y-4">
              <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-[#555] rounded-xl bg-[#1E1E1E]">
                {formData.media_urls?.main_image ? (
                  <div className="relative w-full aspect-square md:aspect-auto md:h-48 mb-4">
                    <img src={formData.media_urls.main_image} alt="Recipe" className="w-full h-full object-contain md:object-cover rounded-lg shadow-md bg-[#111]" />
                  </div>
                ) : (
                  <span className="text-gray-500 mb-2 text-sm">No photo selected</span>
                )}
                <label className="bg-[#333] hover:bg-[#444] px-4 py-3 rounded-md cursor-pointer text-sm font-bold border border-[#555] transition-colors w-full text-center md:w-auto">
                  {imageUploading ? 'Uploading...' : '📸 Upload Photo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={imageUploading} />
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Recipe Title</label>
                <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none" placeholder="e.g. Nunny's Stuffed Peppers"/>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Notes / Description</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none h-20" placeholder="Tips or history..."/>
              </div>

              <div className="border-t border-[#444] pt-4 mt-2">
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Categories</label>
                {formData.categories.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {formData.categories.map(cat => (
                      <span key={cat} className="bg-[#1E1E1E] border border-[#555] px-3 py-1 rounded-full text-sm flex items-center gap-2">
                        {cat}
                        <button onClick={(e) => { e.preventDefault(); handleRemoveCategoryFromForm(cat); }} className="text-[#C53636] font-bold hover:text-red-400 p-1">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input type="text" list="category-options" value={newCategoryInput} onChange={(e) => setNewCategoryInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddCategoryToForm(e)} placeholder="e.g. Dessert, Chicken" className="flex-1 bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none"/>
                  <button onClick={handleAddCategoryToForm} className="bg-[#444] hover:bg-[#555] border border-[#666] px-4 rounded-md font-bold transition-colors">Add</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 border-t border-[#444] pt-4 mt-2">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Servings</label>
                  <input type="number" list="servings-options" value={formData.servings} onChange={e => setFormData({...formData, servings: e.target.value})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none text-center" placeholder="1"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Prep (m)</label>
                  <input type="number" min="0" value={formData.prep_min} onChange={e => setFormData({...formData, prep_min: parseInt(e.target.value) || 0})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none text-center"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Cook (m)</label>
                  <input type="number" min="0" value={formData.cook_min} onChange={e => setFormData({...formData, cook_min: parseInt(e.target.value) || 0})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none text-center"/>
                </div>
              </div>
            </div>

            <div className="bg-[#2D2D2D] rounded-xl p-4 md:p-6 shadow-lg border border-[#444]">
              <div className="flex justify-between items-center mb-4 border-b border-[#555] pb-2">
                <h3 className="font-bold text-gray-300 uppercase tracking-wide text-sm md:text-base">Ingredients</h3>
                {formData.ingredients.length === 0 && (
                  <button onClick={() => setFormData(prev => ({ ...prev, ingredients: [{ name: '', quantity: 1, unit: '' }] }))} className="text-[#C53636] font-bold text-xs md:text-sm bg-[#1E1E1E] px-3 py-2 rounded-md border border-[#444]">+ Add First Ingredient</button>
                )}
              </div>
              
              <div className="space-y-4">
                {formData.ingredients.map((ing, idx) => (
                  <div key={idx} className="bg-[#1E1E1E] p-3 rounded-lg border border-[#444] space-y-3 relative pt-10 sm:pt-3">
                    
                    {/* --- NEW INSERT/DELETE ACTIONS --- */}
                    <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                      <button 
                        onClick={(e) => { 
                          e.preventDefault(); 
                          const newArr = [...formData.ingredients]; 
                          newArr.splice(idx + 1, 0, { name: '', quantity: 1, unit: '' }); 
                          setFormData({...formData, ingredients: newArr}); 
                        }} 
                        className="text-gray-400 hover:text-white text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-[#333] border border-[#555] transition-colors"
                      >
                        + Insert Below
                      </button>
                      <button onClick={() => setFormData(prev => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== idx) }))} className="text-red-500 font-bold hover:text-red-400 px-1 text-lg">✕</button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2 sm:pr-40">
                      <div className="flex gap-2 w-full sm:w-auto">
                        <input type="number" step="any" list="qty-options" value={ing.quantity} onChange={e => { const newArr = [...formData.ingredients]; newArr[idx].quantity = e.target.value; setFormData({...formData, ingredients: newArr}); }} className="w-1/2 sm:w-20 bg-[#333] rounded p-3 outline-none focus:border-[#C53636] border border-[#555] text-center" placeholder="Qty"/>
                        <input type="text" list="unit-options" value={ing.unit} onChange={e => { const newArr = [...formData.ingredients]; newArr[idx].unit = e.target.value; setFormData({...formData, ingredients: newArr}); }} className="w-1/2 sm:w-24 bg-[#333] rounded p-3 outline-none focus:border-[#C53636] border border-[#555] text-center" placeholder="Unit"/>
                      </div>
                      <input type="text" value={ing.name} placeholder="Ingredient Name" onChange={e => { const newArr = [...formData.ingredients]; newArr[idx].name = e.target.value; setFormData({...formData, ingredients: newArr}); }} className="flex-1 bg-[#333] rounded p-3 outline-none focus:border-[#C53636] border border-[#555]"/>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="text" value={ing.notes || ''} placeholder="Notes (optional, e.g. 'diced')" onChange={e => { const newArr = [...formData.ingredients]; newArr[idx].notes = e.target.value; setFormData({...formData, ingredients: newArr}); }} className="flex-1 bg-[#333] rounded p-3 outline-none text-sm border border-[#555] focus:border-[#C53636]"/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#2D2D2D] rounded-xl p-4 md:p-6 shadow-lg border border-[#444]">
              <div className="flex justify-between items-center mb-4 border-b border-[#555] pb-2">
                <h3 className="font-bold text-gray-300 uppercase tracking-wide text-sm md:text-base">Instructions</h3>
                {formData.steps.length === 0 && (
                  <button onClick={() => setFormData(prev => ({ ...prev, steps: [{ text: '' }] }))} className="text-[#C53636] font-bold text-xs md:text-sm bg-[#1E1E1E] px-3 py-2 rounded-md border border-[#444]">+ Add First Step</button>
                )}
              </div>
              
              <div className="space-y-4">
                {formData.steps.map((step, idx) => (
                  <div key={idx} className="bg-[#1E1E1E] p-3 rounded-lg border border-[#444] relative flex flex-col sm:flex-row gap-3 pt-10 sm:pt-3">
                    
                    {/* --- NEW INSERT/DELETE ACTIONS --- */}
                    <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                      <button 
                        onClick={(e) => { 
                          e.preventDefault(); 
                          const newArr = [...formData.steps]; 
                          newArr.splice(idx + 1, 0, { text: '' }); 
                          setFormData({...formData, steps: newArr}); 
                        }} 
                        className="text-gray-400 hover:text-white text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-[#333] border border-[#555] transition-colors"
                      >
                        + Insert Below
                      </button>
                      <button onClick={() => setFormData(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))} className="text-red-500 font-bold hover:text-red-400 px-1 text-lg">✕</button>
                    </div>

                    <div className="flex justify-between items-center sm:block mt-1 sm:mt-0">
                        <div className="font-bold text-[#C53636] text-lg sm:pt-1">Step {idx + 1}.</div>
                    </div>
                    <div className="flex-1 space-y-3 sm:pr-40">
                      <textarea value={step.text} onChange={e => { const newArr = [...formData.steps]; newArr[idx].text = e.target.value; setFormData({...formData, steps: newArr}); }} className="w-full bg-[#333] rounded p-3 outline-none focus:border-[#C53636] border border-[#555] min-h-[100px]" placeholder="Describe this step..."/>
                      <div className="flex justify-start w-full">
                        {step.audio_url ? (
                          <div className="flex flex-col gap-2 w-full">
                            <div className="flex items-center justify-between bg-[#333] p-2 rounded-md border border-[#555]">
                              <span className="text-[#00A023] text-xs md:text-sm font-bold flex items-center">✓ Audio Saved</span>
                              <button onClick={() => { const newArr = [...formData.steps]; newArr[idx].audio_url = ''; setFormData({...formData, steps: newArr}); }} className="text-red-500 text-xs font-bold hover:text-red-400 px-2 py-1">Remove</button>
                            </div>
                            <audio controls src={step.audio_url} className="h-10 outline-none w-full" />
                          </div>
                        ) : (
                          <AudioRecorder onUploadSuccess={(url) => {
                            const newArr = [...formData.steps];
                            newArr[idx].audio_url = url;
                            setFormData({...formData, steps: newArr});
                          }} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      );
    }

    // ----------------------------------------------------------------------------
    // VIEW: COOK MODE (MOBILE & PDF OPTIMIZED)
    // ----------------------------------------------------------------------------
    if (view === 'cook' && selectedRecipe) {
      return (
        <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-2 sm:p-4 md:p-8 pb-12 print:bg-white print:text-black print:min-h-0 print:p-0">
          
          <style>{`
            @media print {
              @page { margin: 1.5cm; }
              body { margin: 0; padding: 0; }
            }
          `}</style>

          <div className="flex justify-between items-center mb-4 md:mb-6 border-b border-[#444] pb-3 md:pb-4 sticky top-0 bg-[#1E1E1E] z-10 pt-2 print:hidden">
            <button onClick={() => { setView('library'); setIsListening(false); }} className="flex items-center text-gray-400 hover:text-white transition-colors font-bold text-sm md:text-base py-2 px-1">
              ← Back
            </button>
            <div className="flex gap-2">
              <button onClick={toggleVoiceMode} className={`px-3 md:px-4 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base flex items-center ${isListening ? 'bg-[#00A023] text-white animate-pulse border border-[#00A023]' : 'bg-[#333] border border-[#555] hover:bg-[#444]'}`} title="Hands-Free Mode">
                🎙️ <span className="hidden md:inline ml-2">{isListening ? 'Listening...' : 'Hey Turtle'}</span>
              </button>
              <button onClick={() => handleShareRecipe(selectedRecipe)} className="bg-[#444] hover:bg-[#555] px-3 md:px-4 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base flex items-center border border-[#555]" title="Share Recipe">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="md:mr-2">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span className="hidden md:inline">Share</span>
              </button>
              <button onClick={() => window.print()} className="bg-[#444] hover:bg-[#555] px-3 md:px-4 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base flex items-center border border-[#555]">
                📄 PDF
              </button>
              <button onClick={() => { handleEditRecipe(selectedRecipe); setIsListening(false); }} className="bg-[#C53636] hover:bg-[#C95757] px-4 md:px-6 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base">
                Edit
              </button>
            </div>
          </div>

          <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-3 md:p-6 mb-4 md:mb-6 shadow-lg flex flex-col md:flex-row gap-4 md:gap-6 print:bg-white print:border-none print:shadow-none print:p-0 print:mb-6 print:flex-row">
            {selectedRecipe.media_urls?.main_image && (
              <div className="relative w-full aspect-square md:aspect-auto md:w-1/3 md:max-h-64 rounded-lg overflow-hidden shadow-inner bg-[#111] shrink-0 print:w-48 print:h-48 print:max-h-48 print:aspect-square print:bg-transparent">
                <img src={selectedRecipe.media_urls.main_image} alt="Recipe" className="w-full h-full object-contain md:object-cover print:object-contain print:object-left-top" />
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-bold mb-2 leading-tight print:text-black">{selectedRecipe.title}</h1>
              <p className="text-gray-400 italic mb-4 text-base md:text-lg print:text-gray-700">{selectedRecipe.description}</p>
              
              {selectedRecipe.categories && selectedRecipe.categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {selectedRecipe.categories.map(cat => (
                    <span key={cat} className="bg-[#1E1E1E] border border-[#555] px-2 py-1 rounded-md text-xs font-bold text-gray-400 uppercase tracking-wider print:bg-gray-100 print:text-gray-800 print:border-gray-300">
                      {cat}
                    </span>
                  ))}
                </div>
              )}

              {/* NEW SCALER AND INFO BAR */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#1E1E1E] p-3 md:p-4 rounded-lg border border-[#444] print:bg-white print:border-gray-300 print:text-black print:p-0 print:border-none">
                
                <div className="flex gap-2 print:hidden">
                  {[0.5, 1, 2, 3].map((mult) => (
                    <button 
                      key={mult}
                      onClick={() => setMultiplier(mult)} 
                      className={`px-3 py-1.5 rounded-md font-bold text-sm transition-colors border ${multiplier === mult ? 'bg-[#C53636] text-white border-[#C53636]' : 'bg-[#333] text-gray-400 border-[#555] hover:bg-[#444]'}`}
                    >
                      {mult === 0.5 ? '½' : mult}x
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 md:gap-4 text-xs md:text-sm text-gray-300 font-bold uppercase tracking-wider print:text-black print:gap-6">
                  <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">
                    🍽 {selectedRecipe.servings ? (parseFloat(String(selectedRecipe.servings)) * multiplier) : '-'} Servings
                  </span>
                  <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">⏱ Prep: {selectedRecipe.prep_min}m</span>
                  <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">🔥 Cook: {selectedRecipe.cook_min}m</span>
                </div>
              </div>

            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 print:block">
            <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-1 shadow-lg print:bg-white print:border-none print:shadow-none print:p-0 print:mb-6">
              <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide print:text-black print:border-gray-300">Ingredients</h2>
              <ul className="space-y-3">
                {selectedRecipe.ingredients?.length > 0 ? selectedRecipe.ingredients.map((ing, idx) => {
                  // MULTIPLY THE QUANTITY BEFORE FORMATTING
                  const baseQty = typeof ing.quantity === 'string' ? parseFloat(ing.quantity) : ing.quantity;
                  const finalQty = isNaN(baseQty) ? ing.quantity : (baseQty * multiplier);

                  return (
                    <li key={idx} className="flex flex-col border-b border-[#444] pb-2 last:border-0 print:border-gray-200">
                      <div className="flex items-start leading-tight">
                        <span className="text-[#C53636] mr-2 font-bold text-lg print:text-black">•</span>
                        <span className="text-base md:text-lg pt-0.5 print:text-black">
                          <strong className="text-[#C53636] print:text-black">
                            {formatFraction(finalQty)} {ing.unit}
                          </strong> {ing.name}
                          {ing.notes && <span className="text-gray-500 text-sm ml-1 italic block sm:inline print:text-gray-600">({ing.notes})</span>}
                        </span>
                      </div>
                    </li>
                  );
                }) : <li className="text-gray-500 italic text-sm">No ingredients added.</li>}
              </ul>
            </div>

            <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-2 shadow-lg print:bg-white print:border-none print:shadow-none print:p-0">
              <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide print:text-black print:border-gray-300">Instructions</h2>
              <div className="space-y-6">
                {selectedRecipe.steps?.length > 0 ? selectedRecipe.steps.map((step, idx) => (
                  <div 
                    id={`recipe-step-${idx}`} 
                    key={idx} 
                    className={`flex gap-3 border-b border-[#444] pb-5 last:border-0 print:border-gray-200 print:break-inside-avoid transition-all duration-500 rounded-lg p-2 ${activeStep === idx ? 'bg-[#3B8ED0]/20 border border-[#3B8ED0] shadow-[0_0_15px_rgba(59,142,208,0.2)]' : ''}`}
                  >
                    <div className="font-bold text-xl md:text-2xl text-[#C53636] shrink-0 print:text-black">{idx + 1}.</div>
                    <div className="flex-1 flex flex-col gap-3">
                      <p className="text-base md:text-lg leading-relaxed text-gray-200 print:text-black">{step.text}</p>
                      {step.audio_url && (
                         <div className="bg-[#1E1E1E] p-2 rounded-lg border border-[#555] w-full mt-1 print:hidden">
                           <span className="text-[10px] md:text-xs text-[#00A023] font-bold uppercase tracking-wider mb-1 block pl-1">Audio Note:</span>
                           <audio controls src={step.audio_url} className="w-full h-10 outline-none" />
                         </div>
                      )}
                    </div>
                  </div>
                )) : <p className="text-gray-500 italic text-sm">No instructions added.</p>}
              </div>
            </div>
          </div>
        </div>
      );
    }



    // ----------------------------------------------------------------------------
    // VIEW: CONVERTER
    // ----------------------------------------------------------------------------
    if (view === 'converter') {
      let topDisplay: string | number | null = "";
      let bottomDisplay: string | number | null = "";
      
      // If the box is empty, don't try to calculate a zero
      if (convInput.val === "") {
        topDisplay = "";
        bottomDisplay = "";
      } else {
        // Whichever box she typed in gets the raw value, the other calculates the math
        topDisplay = convInput.source === 'top' ? convInput.val : doConversion(Number(convInput.val), convTo, convFrom);
        bottomDisplay = convInput.source === 'bottom' ? convInput.val : doConversion(Number(convInput.val), convFrom, convTo);
      }

      return (
        <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-4 md:p-8 pb-24">
          <div className="max-w-xl mx-auto">
            <div className="flex justify-between items-center mb-8 border-b border-[#444] pb-4 sticky top-0 bg-[#1E1E1E] z-10">
              <button onClick={() => setView('library')} className="text-gray-400 hover:text-white transition-colors font-bold text-sm md:text-base py-2">
                ← Back
              </button>
              <h2 className="text-xl md:text-2xl font-bold truncate px-2 text-white">Kitchen Math</h2>
              <div className="w-12"></div>
            </div>

            <div className="bg-[#2D2D2D] rounded-xl p-6 md:p-8 shadow-2xl border border-[#444] flex flex-col gap-8">
              {/* FROM */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold text-[#C53636] uppercase tracking-widest">Convert This</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    type={topDisplay === null ? "text" : "number"}
                    step="any"
                    value={topDisplay === null ? "Incompatible" : topDisplay}
                    onChange={(e) => setConvInput({ val: e.target.value, source: 'top' })}
                    className={`w-full sm:w-1/2 bg-[#1E1E1E] border ${topDisplay === null ? 'border-red-900 bg-red-900/10 text-red-500 text-sm' : 'border-[#555] text-white text-3xl'} rounded-lg p-4 font-bold text-center outline-none focus:border-[#C53636] shadow-inner transition-all`}
                  />
                  <select 
                    value={convFrom}
                    onChange={(e) => setConvFrom(e.target.value)}
                    className="w-full sm:w-1/2 bg-[#1E1E1E] border border-[#555] rounded-lg p-4 text-xl font-bold outline-none focus:border-[#C53636] text-center cursor-pointer shadow-inner appearance-none"
                  >
                    {CONVERTER_OPTIONS.map(opt => <option key={opt} value={opt}>{opt.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>

              {/* DOUBLE ARROW */}
              <div className="flex justify-center -my-4 text-[#555]">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="4" x2="12" y2="20"></line>
                  <polyline points="18 14 12 20 6 14"></polyline>
                  <polyline points="18 10 12 4 6 10"></polyline>
                </svg>
              </div>

              {/* TO */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold text-[#00A023] uppercase tracking-widest">Into This</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    type={bottomDisplay === null ? "text" : "number"}
                    step="any"
                    value={bottomDisplay === null ? "Incompatible" : bottomDisplay}
                    onChange={(e) => setConvInput({ val: e.target.value, source: 'bottom' })}
                    className={`w-full sm:w-1/2 bg-[#1E1E1E] border ${bottomDisplay === null ? 'border-red-900 bg-red-900/10 text-red-500 text-sm' : 'border-[#555] text-white text-3xl'} rounded-lg p-4 font-bold text-center outline-none focus:border-[#00A023] shadow-inner transition-all`}
                  />
                  <select 
                    value={convTo}
                    onChange={(e) => setConvTo(e.target.value)}
                    className="w-full sm:w-1/2 bg-[#1E1E1E] border border-[#555] rounded-lg p-4 text-xl font-bold outline-none focus:border-[#00A023] text-center cursor-pointer shadow-inner appearance-none"
                  >
                    {CONVERTER_OPTIONS.map(opt => <option key={opt} value={opt}>{opt.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              
              {(topDisplay === null || bottomDisplay === null) && (
                <p className="text-[#C53636] text-sm font-bold text-center bg-[#C53636]/10 py-2 rounded border border-[#C53636]/30">You cannot convert between weight, volume, or temperature.</p>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // ----------------------------------------------------------------------------
    // VIEW: LIBRARY
    // ----------------------------------------------------------------------------
    return (
      <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-4 md:p-8">
        
        {/* --- HEADER WRAPPER (Mobile Optimized) --- */}
        <div className="flex flex-row justify-between items-center mb-6 md:mb-8 border-b border-[#333] pb-4 md:pb-6 gap-2">
          
          {/* LOGO AND TITLE */}
          <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
            <img src="/mamalogo.png" alt="Mama Dee's Logo" className="w-8 h-8 md:w-12 md:h-12 object-contain drop-shadow-md shrink-0" />
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-4xl font-bold text-[#C53636] leading-tight truncate">
                Mama Dee's Recipes
              </h1>

              {incompleteRecipeCount > 0 && (
                <span className="text-xs sm:text-sm md:text-lg font-bold text-orange-400 whitespace-nowrap">
                  ({incompleteRecipeCount} incomplete {incompleteRecipeCount === 1 ? 'recipe' : 'recipes'})
                </span>
              )}
            </div>
          </div>

          {/* BUTTONS */}
          <div className="flex gap-1.5 md:gap-3 items-center shrink-0">
            <button onClick={handleShare} title="Share App" className="text-gray-400 hover:text-white transition-colors p-1 md:p-2 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>
            <button onClick={() => setView('converter')} title="Kitchen Math" className="bg-[#444] hover:bg-[#555] w-9 h-9 md:w-auto md:h-auto md:px-4 md:py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base border border-[#555] flex items-center justify-center shrink-0">
              🔄<span className="hidden md:inline md:ml-2">Math</span>
            </button>
            {SHOW_INCOMPLETE_SCAN_BUTTON === 1 && (
              <button onClick={handleQuickScanIncomplete} disabled={quickScanning || loading} title="Scan for incomplete recipes" className="bg-[#444] hover:bg-[#555] disabled:opacity-50 disabled:cursor-not-allowed w-9 h-9 md:w-auto md:h-auto md:px-4 md:py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base border border-[#555] flex items-center justify-center shrink-0">
                {quickScanning ? '...' : '🔎'}<span className="hidden md:inline md:ml-2">{quickScanning ? 'Scanning' : 'Scan'}</span>
              </button>
            )}
            <button onClick={() => requireAuth('settings')} title="Settings" className="bg-[#444] hover:bg-[#555] w-9 h-9 md:w-auto md:h-auto md:px-4 md:py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base border border-[#555] flex items-center justify-center shrink-0">
              ⚙️<span className="hidden md:inline md:ml-2">Settings</span>
            </button>
            <button onClick={handleAddRecipe} title="Add Recipe" className="bg-[#C53636] hover:bg-[#C95757] w-9 h-9 md:w-auto md:h-auto md:px-4 md:py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base flex items-center justify-center shrink-0">
              <span className="md:hidden text-lg leading-none">+</span>
              <span className="hidden md:inline">+ Add</span>
            </button>
          </div>
        </div>
        {/* --- END HEADER WRAPPER --- */}

        <div className="mb-6 flex flex-col md:flex-row gap-3 md:gap-4">
          <input 
            type="text" 
            className="flex-1 bg-[#333] border border-[#444] rounded-md p-3 md:p-4 text-white outline-none focus:border-[#C53636] transition-colors shadow-inner" 
            placeholder={`🔍 Search ${recipes.length} recipes...`} 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
          />
          
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            className="md:w-1/3 bg-[#333] border border-[#444] rounded-md p-3 md:p-4 text-white outline-none focus:border-[#C53636] transition-colors shadow-inner cursor-pointer"
          >
            <option value="">All Categories</option>
            {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center text-gray-500 mt-10 font-bold tracking-widest uppercase text-sm">Loading database...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {filteredRecipes.length > 0 ? (
              filteredRecipes.map((recipe) => (
                // --- UPDATE THIS CLICK EVENT ---
                <div id={`recipe-card-${recipe.id}`} key={recipe.id} onClick={() => { libraryScrollYRef.current = window.scrollY; libraryRestoreRecipeIdRef.current = String(recipe.id); setSelectedRecipe(recipe); setMultiplier(1); setActiveStep(-1); setIsListening(false); setView('cook'); }} className={`relative bg-[#2D2D2D] border rounded-xl cursor-pointer transition-all shadow-lg overflow-hidden flex flex-col ${
                    (recipe.categories || []).includes(INCOMPLETE_CATEGORY)
                      ? 'border-4 border-red-600 ring-2 ring-red-600/60 hover:border-red-400'
                      : 'border-[#444] hover:border-[#C53636]'
                  }`}>
                  
                  {/* --- 3-DOT MENU BUTTON --- */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // Don't trigger the card's main click event
                      setOpenMenuId(openMenuId === recipe.id ? null : recipe.id || null);
                    }}
                    className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors flex items-center justify-center w-8 h-8"
                  >
                    {/* SVG for 3 vertical dots */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="1"></circle>
                      <circle cx="12" cy="5" r="1"></circle>
                      <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                  </button>

                  {/* --- 3-DOT MENU DROPDOWN --- */}
                  {openMenuId === recipe.id && (
                    <>
                      {/* Invisible overlay to close menu if clicked outside */}
                      <div className="fixed inset-0 z-20 cursor-default" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }} />
                      <div className="absolute top-11 right-2 z-30 bg-[#1E1E1E] border border-[#555] rounded-md shadow-xl py-1 w-36 overflow-hidden">
                        <button
                          onClick={(e) => handleDuplicateRecipe(e, recipe)}
                          className="w-full text-left px-4 py-2 text-white hover:bg-[#333] transition-colors font-bold text-sm border-b border-[#444]"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={(e) => handleDeleteRecipe(e, recipe)}
                          className="w-full text-left px-4 py-2 text-[#C53636] hover:bg-[#333] transition-colors font-bold text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}

                  {recipe.media_urls?.main_image ? (
                    <div className="relative h-40 md:h-48 w-full bg-[#1E1E1E]">
                      <img src={recipe.media_urls.main_image} alt={recipe.title} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-40 md:h-48 w-full bg-[#1E1E1E] flex items-center justify-center text-[#555] font-bold tracking-widest uppercase text-xs md:text-sm border-b border-[#444]">No Image</div>
                  )}
                  <div className="p-4 md:p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-lg md:text-xl font-bold mb-2 leading-tight">{recipe.title}</h3>
                      <div className="text-xs md:text-sm text-gray-500 italic mb-4">{recipe.categories?.join(', ') || 'Uncategorized'}</div>
                    </div>
                    <div className="flex gap-3 md:gap-4 text-xs md:text-sm text-gray-400 font-bold pt-3 md:pt-4 border-t border-[#444]">
                      <span>⏱ {recipe.prep_min + recipe.cook_min}m</span>
                      <span>🍽 {recipe.servings} servings</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center text-gray-500 mt-10 font-bold uppercase tracking-widest text-sm">No recipes found.</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================================================
  // COMPONENT RETURN (Wraps Content + Modals)
  // ============================================================================
  return (
    <>
      {renderContent()}

      {/* GLOBAL MODALS */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form onSubmit={handleAuthSubmit} className="bg-[#1E1E1E] border border-[#555] rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Enter Password</h2>
            <input 
              type="password" 
              autoFocus
              value={passwordInput} 
              onChange={(e) => setPasswordInput(e.target.value)} 
              className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none mb-4" 
              placeholder="Password..."
            />
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowPasswordModal(false)} className="px-4 py-2 text-gray-400 hover:text-white font-bold">Cancel</button>
              <button type="submit" className="bg-[#C53636] hover:bg-[#C95757] px-4 py-2 rounded-md font-bold text-white shadow-lg">Submit</button>
            </div>
          </form>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#1E1E1E] border border-[#555] rounded-xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b border-[#444] pb-3 shrink-0">
              <h2 className="text-xl font-bold">App Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white font-bold text-xl">✕</button>
            </div>

            <div className="space-y-6 overflow-y-auto pr-2 flex-1">
              
              <div className="bg-[#2D2D2D] p-4 rounded-lg border border-[#444]">
                <h3 className="font-bold text-[#C53636] mb-2 uppercase tracking-wider text-sm">Security</h3>
                <p className="text-xs text-gray-400 mb-3 leading-relaxed">Set a local password to protect adding, editing, deleting, and accessing settings on this device.</p>
                <input 
                  type="password" 
                  placeholder={appPassword ? "Enter new password to change..." : "Set a password..."} 
                  className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSavePassword(e.currentTarget.value);
                      e.currentTarget.value = ""; // Clear the box after saving
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value) {
                      handleSavePassword(e.target.value);
                      e.target.value = ""; // Clear the box after saving
                    }
                  }}
                />
                {appPassword && (
                   <button onClick={() => { if(window.confirm("Remove password?")) handleSavePassword(""); }} className="text-xs text-red-400 hover:text-red-300 font-bold mt-3 border border-red-900/50 bg-red-900/20 px-3 py-1 rounded">Remove Password</button>
                )}
              </div>

              <div className="bg-[#2D2D2D] p-4 rounded-lg border border-[#444]">
                <h3 className="font-bold text-[#C53636] mb-3 uppercase tracking-wider text-sm">Manage Categories</h3>
                {allCategories.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No categories found.</p>
                ) : (
                  <div className="space-y-2">
                    {allCategories.map(cat => (
                      <div key={cat} className="flex items-center justify-between bg-[#1E1E1E] p-2 rounded border border-[#555]">
                        {catOldName === cat ? (
                          <div className="flex w-full gap-2">
                            <input 
                              type="text" 
                              autoFocus
                              value={catEditName} 
                              onChange={e => setCatEditName(e.target.value)} 
                              className="flex-1 bg-[#333] rounded px-2 py-1 outline-none text-sm focus:border-[#C53636] border border-[#444] min-w-0"
                            />
                            <button onClick={() => handleUpdateCategory(cat, catEditName)} className="text-green-500 font-bold text-sm shrink-0">Save</button>
                            <button onClick={() => setCatOldName("")} className="text-gray-400 font-bold text-sm shrink-0">Cancel</button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-bold text-gray-300 truncate pr-2">{cat}</span>
                            <div className="flex gap-3 shrink-0">
                              <button onClick={() => { setCatOldName(cat); setCatEditName(cat); }} className="text-gray-400 hover:text-white text-sm font-bold">Edit</button>
                              <button 
                                onClick={() => {
                                  if (window.confirm(`Are you sure you want to remove "${cat}" from all recipes?`)) {
                                    handleUpdateCategory(cat, "");
                                  }
                                }} 
                                className="text-red-500 hover:text-red-400 text-sm font-bold"
                              >Delete</button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    {/* AI IMPORT MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#1E1E1E] border border-[#555] rounded-xl p-6 w-full max-w-lg shadow-2xl flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b border-[#444] pb-3">
              <h2 className="text-xl font-bold flex items-center gap-2">✨ Import via AI</h2>
              <button onClick={() => !aiProcessing && setShowAiModal(false)} className="text-gray-400 hover:text-white font-bold text-xl">✕</button>
            </div>

            <form onSubmit={processAiImport} className="space-y-4">
              <div className="flex gap-1 p-1 bg-[#333] rounded-md overflow-x-auto">
                <button type="button" onClick={() => { setAiInputMode('url'); setAiInputText(''); }} className={`flex-1 px-2 py-2 text-xs font-bold rounded whitespace-nowrap ${aiInputMode === 'url' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Website</button>
                <button type="button" onClick={() => { setAiInputMode('upload'); setAiInputText(''); }} className={`flex-1 px-2 py-2 text-xs font-bold rounded whitespace-nowrap ${aiInputMode === 'upload' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Upload Photo</button>
                <button type="button" onClick={() => { setAiInputMode('camera'); setAiInputText(''); }} className={`flex-1 px-2 py-2 text-xs font-bold rounded whitespace-nowrap ${aiInputMode === 'camera' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Take Photo</button>
                <button type="button" onClick={() => { setAiInputMode('text'); setAiInputText(''); }} className={`flex-1 px-2 py-2 text-xs font-bold rounded whitespace-nowrap ${aiInputMode === 'text' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Paste Text</button>
              </div>

              {aiInputMode === 'url' && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Recipe Link</label>
                  <input type="url" required value={aiInputText} onChange={(e) => setAiInputText(e.target.value)} placeholder="https://..." className="w-full bg-[#2D2D2D] border border-[#555] rounded-md p-3 text-white focus:border-[#3B8ED0] outline-none"/>
                  <p className="text-xs text-gray-500 mt-2">Paste a link to any food blog. The AI will read the site and extract the ingredients and instructions automatically.</p>
                </div>
              )}

              {aiInputMode === 'upload' && (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#555] rounded-xl bg-[#2D2D2D]">
                  <label className="bg-[#333] hover:bg-[#444] px-6 py-3 rounded-md cursor-pointer text-sm font-bold border border-[#555] transition-colors text-center w-full">
                    📁 Choose File
                    <input type="file" id="ai-upload-input" accept="image/*" className="hidden" onChange={() => setAiInputText("photo_selected")} />
                  </label>
                  {aiInputText === "photo_selected" && <p className="text-[#00A023] text-xs mt-3 font-bold">✓ Photo ready to scan</p>}
                  <p className="text-xs text-gray-500 mt-4 text-center">Select an existing photo of a recipe card or clipping.</p>
                </div>
              )}

              {aiInputMode === 'camera' && (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#555] rounded-xl bg-[#2D2D2D]">
                  <label className="bg-[#333] hover:bg-[#444] px-6 py-3 rounded-md cursor-pointer text-sm font-bold border border-[#555] transition-colors text-center w-full">
                    📸 Open Camera
                    <input type="file" id="ai-camera-input" accept="image/*" capture="environment" className="hidden" onChange={() => setAiInputText("photo_selected")} />
                  </label>
                  {aiInputText === "photo_selected" && <p className="text-[#00A023] text-xs mt-3 font-bold">✓ Photo ready to scan</p>}
                  <p className="text-xs text-gray-500 mt-4 text-center">Snap a fresh picture of a recipe right now.</p>
                </div>
              )}

              {aiInputMode === 'text' && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Raw Text</label>
                  <textarea required value={aiInputText} onChange={(e) => setAiInputText(e.target.value)} placeholder="Paste messy email text, ingredients, etc..." className="w-full bg-[#2D2D2D] border border-[#555] rounded-md p-3 text-white focus:border-[#3B8ED0] outline-none h-48 resize-none"/>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-[#444]">
                <button type="button" onClick={() => setShowAiModal(false)} disabled={aiProcessing} className="px-4 py-2 text-gray-400 hover:text-white font-bold disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={aiProcessing || (!aiInputText.trim() && aiInputMode !== 'upload' && aiInputMode !== 'camera') || (aiInputText !== 'photo_selected' && (aiInputMode === 'upload' || aiInputMode === 'camera'))} className="bg-[#3B8ED0] hover:bg-[#2b6a9e] disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2 rounded-md font-bold text-white shadow-lg flex items-center gap-2">
                  {aiProcessing ? (
                    <><span className="animate-spin">⏳</span> Scanning...</>
                  ) : 'Extract Recipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}