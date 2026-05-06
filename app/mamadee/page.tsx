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
  
  const [formData, setFormData] = useState<Recipe>({
    title: '', description: '', servings: 1, prep_min: 0, cook_min: 0, categories: [], ingredients: [], steps: [], media_urls: {}
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("");
  const [newCategoryInput, setNewCategoryInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('mamadee').select('*').order('created_at', { ascending: false });
    if (!error) setRecipes(data as Recipe[] || []);
    setLoading(false);
  };

  const allCategories = Array.from(new Set(recipes.flatMap(r => r.categories || []))).sort();

  const filteredRecipes = recipes.filter(r => {
    const matchesSearch = r.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategoryFilter === "" || (r.categories || []).includes(selectedCategoryFilter);
    return matchesSearch && matchesCategory;
  });

  const handleAddRecipe = () => {
    setFormData({ 
      title: '', description: '', servings: 1, prep_min: 0, cook_min: 0, categories: [], media_urls: {},
      ingredients: [{ name: '', quantity: 1, unit: 'whole' }], 
      steps: [{ text: '' }] 
    });
    setSelectedRecipe(null);
    setView('edit');
  };

  const handleEditRecipe = (recipe: Recipe) => {
    setFormData({ 
      ...recipe, 
      media_urls: recipe.media_urls || {},
      categories: recipe.categories || [],
      ingredients: recipe.ingredients?.length > 0 ? recipe.ingredients : [{ name: '', quantity: 1, unit: 'whole' }],
      steps: recipe.steps?.length > 0 ? recipe.steps : [{ text: '' }]
    });
    setView('edit');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    const fileName = `image_${Date.now()}_${file.name}`;
    
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
      steps: formData.steps.filter(step => step.text.trim() !== ''),
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

  // ============================================================================
  // VIEW: EDIT / ADD MODE
  // ============================================================================
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
          <div className="bg-[#2D2D2D] rounded-xl p-4 md:p-6 shadow-lg border border-[#444] space-y-4">
            <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-[#555] rounded-xl bg-[#1E1E1E]">
              {formData.media_urls?.main_image ? (
                <div className="relative w-full h-40 md:h-48 mb-4">
                  <img src={formData.media_urls.main_image} alt="Recipe" className="w-full h-full object-cover rounded-lg shadow-md" />
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
              <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-[#333] border border-[#555] rounded-md p-3 text-white focus:border-[#C53636] outline-none" placeholder="e.g. Grandma's Famous Lasagna"/>
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
              <button onClick={() => setFormData(prev => ({ ...prev, ingredients: [...prev.ingredients, { name: '', quantity: 1, unit: 'whole' }] }))} className="text-[#C53636] font-bold text-xs md:text-sm bg-[#1E1E1E] px-3 py-2 rounded-md border border-[#444]">+ Add</button>
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

  // ============================================================================
  // VIEW: COOK MODE (MOBILE OPTIMIZED)
  // ============================================================================
  if (view === 'cook' && selectedRecipe) {
    return (
      <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-3 md:p-8 pb-12">
        <div className="flex justify-between items-center mb-4 md:mb-6 border-b border-[#444] pb-3 md:pb-4 sticky top-0 bg-[#1E1E1E] z-10 pt-2">
          <button onClick={() => setView('library')} className="flex items-center text-gray-400 hover:text-white transition-colors font-bold text-sm md:text-base py-2 px-1">
            ← Back
          </button>
          <button onClick={() => handleEditRecipe(selectedRecipe)} className="bg-[#C53636] hover:bg-[#C95757] px-4 md:px-6 py-2 rounded-md font-bold transition-colors shadow-lg text-sm md:text-base">
            Edit
          </button>
        </div>

        <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-3 md:p-6 mb-4 md:mb-6 shadow-lg flex flex-col md:flex-row gap-4 md:gap-6">
          {selectedRecipe.media_urls?.main_image && (
            <div className="relative w-full md:w-1/3 h-56 md:h-auto rounded-lg overflow-hidden shadow-inner bg-[#1E1E1E] shrink-0">
              <img src={selectedRecipe.media_urls.main_image} alt="Recipe" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold mb-2 leading-tight">{selectedRecipe.title}</h1>
            <p className="text-gray-400 italic mb-4 text-base md:text-lg">{selectedRecipe.description}</p>
            
            {selectedRecipe.categories && selectedRecipe.categories.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {selectedRecipe.categories.map(cat => (
                  <span key={cat} className="bg-[#1E1E1E] border border-[#555] px-2 py-1 rounded-md text-xs font-bold text-gray-400 uppercase tracking-wider">
                    {cat}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 md:gap-4 text-xs md:text-sm text-gray-300 font-bold uppercase tracking-wider bg-[#1E1E1E] p-3 md:p-4 rounded-lg border border-[#444]">
              <span className="bg-[#333] px-2 py-1 rounded">🍽 {selectedRecipe.servings} Servings</span>
              <span className="bg-[#333] px-2 py-1 rounded">⏱ Prep: {selectedRecipe.prep_min}m</span>
              <span className="bg-[#333] px-2 py-1 rounded">🔥 Cook: {selectedRecipe.cook_min}m</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-1 shadow-lg">
            <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide">Ingredients</h2>
            <ul className="space-y-3">
              {selectedRecipe.ingredients?.length > 0 ? selectedRecipe.ingredients.map((ing, idx) => (
                <li key={idx} className="flex flex-col border-b border-[#444] pb-2 last:border-0">
                  <div className="flex items-start leading-tight">
                    <span className="text-[#C53636] mr-2 font-bold text-lg">•</span>
                    <span className="text-base md:text-lg pt-0.5">
                      <strong className="text-[#C53636]">{ing.quantity} {ing.unit}</strong> {ing.name}
                      {ing.notes && <span className="text-gray-500 text-sm ml-1 italic block sm:inline">({ing.notes})</span>}
                    </span>
                  </div>
                </li>
              )) : <li className="text-gray-500 italic text-sm">No ingredients added.</li>}
            </ul>
          </div>

          <div className="bg-[#2D2D2D] border border-[#444] rounded-xl p-4 md:p-6 md:col-span-2 shadow-lg">
            <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 border-b border-[#555] pb-2 uppercase tracking-wide">Instructions</h2>
            <div className="space-y-6">
              {selectedRecipe.steps?.length > 0 ? selectedRecipe.steps.map((step, idx) => (
                <div key={idx} className="flex flex-col md:flex-row gap-2 md:gap-4 border-b border-[#444] pb-5 last:border-0">
                  <div className="font-bold text-xl md:text-2xl text-[#C53636] shrink-0">{idx + 1}.</div>
                  <div className="flex-1 flex flex-col gap-3">
                    <p className="text-base md:text-lg leading-relaxed text-gray-200">{step.text}</p>
                    {step.audio_url && (
                       <div className="bg-[#1E1E1E] p-2 rounded-lg border border-[#555] w-full mt-1">
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

  // ============================================================================
  // VIEW: LIBRARY
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#1E1E1E] text-white font-sans p-4 md:p-8">
      <div className="flex justify-between items-center mb-6 md:mb-8 border-b border-[#333] pb-4 md:pb-6">
        <div className="flex items-center gap-3 md:gap-4">
          <img src="/mamalogo.png" alt="Mama Dee's Logo" className="w-10 h-10 md:w-12 md:h-12 object-contain drop-shadow-md" />
          <h1 className="text-xl md:text-4xl font-bold text-[#C53636] leading-tight">Mama Dee's Recipes</h1>
        </div>
        <button onClick={handleAddRecipe} className="bg-[#C53636] hover:bg-[#C95757] p-2 px-3 md:px-4 md:py-2 rounded-md font-bold transition-colors shadow-md text-sm md:text-base">
          + Add
        </button>
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
              <div key={recipe.id} onClick={() => { setSelectedRecipe(recipe); setView('cook'); }} className="bg-[#2D2D2D] border border-[#444] rounded-xl cursor-pointer hover:border-[#C53636] transition-all shadow-lg overflow-hidden flex flex-col">
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
}