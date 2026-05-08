"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "../../utils/supabase"; 
import { useRouter } from "next/navigation";

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

  // If it's a weird decimal that doesn't map to a cooking fraction, just show the number
  if (!fraction) return num.toString();

  // Combine whole number and fraction (e.g., "2 ¼" or just "¼")
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
  const [view, setView] = useState<'library' | 'cook' | 'edit'>('library');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  
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

  // --- NEW STATE FOR SETTINGS & AUTH ---
  const [appPassword, setAppPassword] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState<{ type: string, payload?: any } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [catEditName, setCatEditName] = useState("");
  const [catOldName, setCatOldName] = useState("");

  // --- NEW STATE FOR AI FEATURE ---
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInputMode, setAiInputMode] = useState<'text' | 'url'>('url');
  const [aiInputText, setAiInputText] = useState("");
  const [aiProcessing, setAiProcessing] = useState(false);

  useEffect(() => {
    // Load local device password on mount
    setAppPassword(localStorage.getItem('mamadee_password') || "");
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
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
    }
    setLoading(false);
  };

  const allCategories = Array.from(new Set(recipes.flatMap(r => r.categories || []))).sort();

  const filteredRecipes = recipes.filter(r => {
    const matchesSearch = r.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategoryFilter === "" || (r.categories || []).includes(selectedCategoryFilter);
    return matchesSearch && matchesCategory;
  });

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

    const cleanedFormData = {
      ...formData,
      ingredients: formData.ingredients.filter(ing => ing.name.trim() !== ''),
      steps: formData.steps.filter(step => step.text.trim() !== '' || !!step.audio_url),
      servings: typeof formData.servings === 'string' ? parseFloat(formData.servings) || 1 : formData.servings
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
    if (!aiInputText.trim()) return;
    
    setAiProcessing(true);
    try {
      const res = await fetch('/api/ai-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: aiInputMode, content: aiInputText })
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
                <button onClick={() => setFormData(prev => ({ ...prev, ingredients: [...prev.ingredients, { name: '', quantity: 1, unit: '' }] }))} className="text-[#C53636] font-bold text-xs md:text-sm bg-[#1E1E1E] px-3 py-2 rounded-md border border-[#444]">+ Add</button>
              </div>
              
              <div className="space-y-4">
                {formData.ingredients.map((ing, idx) => (
                  <div key={idx} className="bg-[#1E1E1E] p-3 rounded-lg border border-[#444] space-y-3 relative pt-8 sm:pt-3">
                    <button onClick={() => setFormData(prev => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== idx) }))} className="absolute top-1 right-2 text-red-500 font-bold hover:text-red-400 p-2 text-lg">✕</button>
                    
                    <div className="flex flex-col sm:flex-row gap-2 sm:pr-8">
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
                <button onClick={() => setFormData(prev => ({ ...prev, steps: [...prev.steps, { text: '' }] }))} className="text-[#C53636] font-bold text-xs md:text-sm bg-[#1E1E1E] px-3 py-2 rounded-md border border-[#444]">+ Add Step</button>
              </div>
              
              <div className="space-y-4">
                {formData.steps.map((step, idx) => (
                  <div key={idx} className="bg-[#1E1E1E] p-3 rounded-lg border border-[#444] relative flex flex-col sm:flex-row gap-3">
                    <div className="flex justify-between items-center sm:block">
                        <div className="font-bold text-[#C53636] text-lg sm:pt-2">Step {idx + 1}.</div>
                        <button onClick={() => setFormData(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))} className="text-red-500 font-bold hover:text-red-400 p-2 text-lg sm:absolute sm:top-1 sm:right-2">✕</button>
                    </div>
                    <div className="flex-1 space-y-3 sm:pr-8">
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
            <button onClick={() => setView('library')} className="flex items-center text-gray-400 hover:text-white transition-colors font-bold text-sm md:text-base py-2 px-1">
              ← Back
            </button>
            <div className="flex gap-2">
              <button onClick={() => handleShareRecipe(selectedRecipe)} className="bg-[#444] hover:bg-[#555] px-3 md:px-4 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base flex items-center" title="Share Recipe">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="md:mr-2">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span className="hidden md:inline">Share</span>
              </button>
              <button onClick={() => window.print()} className="bg-[#444] hover:bg-[#555] px-3 md:px-4 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base flex items-center">
                📄 PDF
              </button>
              <button onClick={() => handleEditRecipe(selectedRecipe)} className="bg-[#C53636] hover:bg-[#C95757] px-4 md:px-6 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base">
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

              <div className="flex flex-wrap gap-2 md:gap-4 text-xs md:text-sm text-gray-300 font-bold uppercase tracking-wider bg-[#1E1E1E] p-3 md:p-4 rounded-lg border border-[#444] print:bg-white print:border-gray-300 print:text-black print:p-0 print:border-none print:gap-6">
                <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">🍽 {selectedRecipe.servings} Servings</span>
                <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">⏱ Prep: {selectedRecipe.prep_min}m</span>
                <span className="bg-[#333] px-2 py-1 rounded print:bg-transparent print:p-0">🔥 Cook: {selectedRecipe.cook_min}m</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 print:block">
            <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-1 shadow-lg print:bg-white print:border-none print:shadow-none print:p-0 print:mb-6">
              <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide print:text-black print:border-gray-300">Ingredients</h2>
              <ul className="space-y-3">
                {selectedRecipe.ingredients?.length > 0 ? selectedRecipe.ingredients.map((ing, idx) => (
                  <li key={idx} className="flex flex-col border-b border-[#444] pb-2 last:border-0 print:border-gray-200">
                    <div className="flex items-start leading-tight">
                      <span className="text-[#C53636] mr-2 font-bold text-lg print:text-black">•</span>
                      <span className="text-base md:text-lg pt-0.5 print:text-black">
                        <strong className="text-[#C53636] print:text-black">
                          {formatFraction(ing.quantity)} {ing.unit}
                        </strong> {ing.name}
                        {ing.notes && <span className="text-gray-500 text-sm ml-1 italic block sm:inline print:text-gray-600">({ing.notes})</span>}
                      </span>
                    </div>
                  </li>
                )) : <li className="text-gray-500 italic text-sm">No ingredients added.</li>}
              </ul>
            </div>

            <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-2 shadow-lg print:bg-white print:border-none print:shadow-none print:p-0">
              <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide print:text-black print:border-gray-300">Instructions</h2>
              <div className="space-y-6">
                {selectedRecipe.steps?.length > 0 ? selectedRecipe.steps.map((step, idx) => (
                  <div key={idx} className="flex gap-3 border-b border-[#444] pb-5 last:border-0 print:border-gray-200 print:break-inside-avoid">
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
    // VIEW: LIBRARY
    // ----------------------------------------------------------------------------
    return (
      <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-4 md:p-8">
        <div className="flex justify-between items-center mb-6 md:mb-8 border-b border-[#333] pb-4 md:pb-6">
          <div className="flex items-center gap-3 md:gap-4">
            <img src="/mamalogo.png" alt="Mama Dee's Logo" className="w-10 h-10 md:w-12 md:h-12 object-contain drop-shadow-md" />
            <h1 className="text-xl md:text-4xl font-bold text-[#C53636] leading-tight">Mama Dee's Recipes</h1>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={handleShare} title="Share App" className="text-gray-400 hover:text-white transition-colors p-2 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>
            <button onClick={() => requireAuth('settings')} className="w-24 md:w-32 bg-[#444] hover:bg-[#555] py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base border border-[#555] text-center shrink-0">
              ⚙️ Settings
            </button>
            <button onClick={handleAddRecipe} className="w-24 md:w-32 bg-[#C53636] hover:bg-[#C95757] py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base text-center shrink-0">
              + Add
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-col md:flex-row gap-3 md:gap-4">
          <input type="text" className="flex-1 bg-[#333] border border-[#444] rounded-md p-3 md:p-4 text-white outline-none focus:border-[#C53636] transition-colors shadow-inner" placeholder="🔍 Search recipes by title..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          
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
                <div key={recipe.id} onClick={() => { setSelectedRecipe(recipe); setView('cook'); }} className="relative bg-[#2D2D2D] border border-[#444] rounded-xl cursor-pointer hover:border-[#C53636] transition-all shadow-lg overflow-hidden flex flex-col">
                  
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
              <div className="flex gap-2 p-1 bg-[#333] rounded-md">
                <button type="button" onClick={() => setAiInputMode('url')} className={`flex-1 py-2 text-sm font-bold rounded ${aiInputMode === 'url' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Website URL</button>
                <button type="button" onClick={() => setAiInputMode('text')} className={`flex-1 py-2 text-sm font-bold rounded ${aiInputMode === 'text' ? 'bg-[#3B8ED0] text-white shadow' : 'text-gray-400 hover:text-white'}`}>Paste Text</button>
              </div>

              {aiInputMode === 'url' ? (
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Recipe Link</label>
                  <input type="url" required value={aiInputText} onChange={(e) => setAiInputText(e.target.value)} placeholder="https://..." className="w-full bg-[#2D2D2D] border border-[#555] rounded-md p-3 text-white focus:border-[#3B8ED0] outline-none"/>
                  <p className="text-xs text-gray-500 mt-2">Paste a link to any food blog. The AI will read the site and extract the ingredients and instructions automatically.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Raw Text</label>
                  <textarea required value={aiInputText} onChange={(e) => setAiInputText(e.target.value)} placeholder="Paste messy email text, ingredients, etc..." className="w-full bg-[#2D2D2D] border border-[#555] rounded-md p-3 text-white focus:border-[#3B8ED0] outline-none h-48 resize-none"/>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-[#444]">
                <button type="button" onClick={() => setShowAiModal(false)} disabled={aiProcessing} className="px-4 py-2 text-gray-400 hover:text-white font-bold disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={aiProcessing || !aiInputText.trim()} className="bg-[#3B8ED0] hover:bg-[#2b6a9e] disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2 rounded-md font-bold text-white shadow-lg flex items-center gap-2">
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