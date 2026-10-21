"use client";
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Loader2, Plus, Save, Scale, Sparkles, Trash2, UtensilsCrossed } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

interface Recipe {
  id: string;
  menu_item: string;
  ingredients: Ingredient[];
}

interface Prediction {
  ingredient_name: string;
  total_required: number;
  unit: string;
  confidence: number;
}

type RecipeStatus = {
  type: "success" | "error" | "loading" | "info";
  text: string;
};

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPrediction, setShowPrediction] = useState(false);
  const [status, setStatus] = useState<RecipeStatus | null>(null);
  
  const [newRecipe, setNewRecipe] = useState({
    menu_item: '',
    ingredients: [{ name: '', quantity: 0, unit: 'gm' }]
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchRecipes(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchRecipes = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/recipes/'), { signal, credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.detail || data.message || "Recipe data is temporarily unavailable.");
      setRecipes(Array.isArray(data) ? data : []);
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : "Recipe data is temporarily unavailable.";
      setStatus({ type: "error", text: message });
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  };

  const handleAddIngredient = () => {
    setNewRecipe({
      ...newRecipe,
      ingredients: [...newRecipe.ingredients, { name: '', quantity: 0, unit: 'gm' }]
    });
  };

  const handleRemoveIngredient = (index: number) => {
    const list = [...newRecipe.ingredients];
    list.splice(index, 1);
    setNewRecipe({ ...newRecipe, ingredients: list });
  };

  const handleIngredientChange = (index: number, field: keyof Ingredient, value: string | number) => {
    const list = [...newRecipe.ingredients];
    list[index] = { ...list[index], [field]: value };
    setNewRecipe({ ...newRecipe, ingredients: list });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: "loading", text: "Saving master recipe..." });
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/recipes/'), {
        method: 'POST',
        credentials: "include",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRecipe)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || "Failed to save recipe.");
      setNewRecipe({ menu_item: '', ingredients: [{ name: '', quantity: 0, unit: 'gm' }] });
      setStatus({
        type: "success",
        text: `${data.menu_item || newRecipe.menu_item} recipe saved with ${Array.isArray(data.ingredients) ? data.ingredients.length : newRecipe.ingredients.length} ingredient${(Array.isArray(data.ingredients) ? data.ingredients.length : newRecipe.ingredients.length) === 1 ? "" : "s"}.`,
      });
      await fetchRecipes();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save recipe.";
      setStatus({ type: "error", text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchPredictions = async () => {
    setIsSubmitting(true);
    setShowPrediction(true);
    setStatus({ type: "loading", text: "Running prep prediction..." });
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/recipes/next-day-prediction'), {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || "Failed to fetch predictions.");
      const predictionRows = Array.isArray(data.predictions) ? data.predictions : [];
      setPredictions(predictionRows);
      setStatus({
        type: "success",
        text: `Prep prediction ready with ${predictionRows.length} ingredient forecast${predictionRows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch predictions.";
      setPredictions([]);
      setStatus({ type: "error", text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Recipe Intelligence</h1>
          <p className="text-gray-500 text-sm">Automate your prep and minimize ingredient waste.</p>
        </div>
        <button 
          onClick={fetchPredictions}
          disabled={isSubmitting}
          className="bg-indigo-600 text-white px-8 py-4 rounded-3xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center space-x-3 uppercase text-xs tracking-widest"
        >
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
          <span>Run Predictive Analytics</span>
        </button>
      </div>

      {status && (
        <div
          role={status.type === "error" ? "alert" : "status"}
          className={`flex items-center gap-2 rounded-2xl border px-5 py-4 text-sm font-bold ${
            status.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : status.type === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : status.type === "loading"
                  ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                  : "border-gray-200 bg-gray-50 text-gray-700"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : status.type === "error" ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : status.type === "loading" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          <span>{status.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Save Recipe Card */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <UtensilsCrossed className="w-32 h-32" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-indigo-600" />
            Define Master Recipe
          </h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Menu Item Selection</label>
              <input 
                type="text" 
                aria-label="Recipe menu item"
                required
                value={newRecipe.menu_item}
                onChange={e => setNewRecipe({...newRecipe, menu_item: e.target.value})}
                className="w-full mt-2 p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-bold text-gray-900"
                placeholder="e.g. Pepperoni Feast Large"
              />
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Ingredient Architecture</label>
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} className="flex space-x-3 group animate-in slide-in-from-left-2 fade-in">
                  <input 
                    type="text" 
                    aria-label={`Ingredient ${idx + 1} name`}
                    placeholder="Ingredient"
                    className="flex-1 p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm"
                    value={ing.name}
                    onChange={e => handleIngredientChange(idx, 'name', e.target.value)}
                  />
                  <input 
                    type="number" 
                    aria-label={`Quantity for ingredient ${idx + 1}`}
                    className="w-20 p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm italic"
                    value={ing.quantity}
                    onChange={e => handleIngredientChange(idx, 'quantity', Number(e.target.value))}
                  />
                  <select 
                    aria-label={`Unit for ingredient ${idx + 1}`}
                    className="w-20 p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold"
                    value={ing.unit}
                    onChange={e => handleIngredientChange(idx, 'unit', e.target.value)}
                  >
                    <option value="gm">GM</option>
                    <option value="ml">ML</option>
                    <option value="unit">Unit</option>
                  </select>
                  <button 
                    type="button" 
                    aria-label={`Remove ingredient ${idx + 1}`}
                    onClick={() => handleRemoveIngredient(idx)}
                    className="p-3 text-red-200 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={handleAddIngredient}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center mt-2 group"
              >
                <Plus className="w-4 h-4 mr-1 group-hover:scale-125 transition-all" />
                Add Component
              </button>
            </div>

            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gray-900 text-white p-5 rounded-3xl font-black hover:bg-black transition-all flex items-center justify-center space-x-2 shadow-lg disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              <span>Register Recipe</span>
            </button>
          </form>
        </div>

        {/* Prediction Results or Existing Recipes */}
        <div className="space-y-6">
          {showPrediction && (
            <div className="bg-indigo-900 p-8 rounded-3xl text-white shadow-2xl shadow-indigo-200 animate-in zoom-in-95 duration-500">
               <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-2xl font-black italic tracking-tighter">TOMORROW&apos;S PREP</h3>
                  <p className="text-indigo-300 text-xs font-bold opacity-80 uppercase">AI Generated Resource Forecast</p>
                </div>
                <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                   <Sparkles className="w-6 h-6 text-indigo-300" />
                </div>
               </div>

               <div className="space-y-4">
                 {predictions.map((p, i) => (
                   <div key={i} className="flex justify-between items-center p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors">
                     <div>
                       <p className="text-sm font-black text-indigo-100">{p.ingredient_name}</p>
                       <p className="text-[10px] text-indigo-400 font-bold">Confidence Level: {Math.round(p.confidence * 100)}%</p>
                     </div>
                     <div className="text-right">
                        <p className="text-xl font-black text-white">{p.total_required}</p>
                        <p className="text-[9px] uppercase font-bold text-indigo-400">{p.unit} Required</p>
                     </div>
                   </div>
                 ))}
                 {predictions.length === 0 && !isSubmitting && (
                   <div className="py-8 text-center text-indigo-400 text-sm italic">
                     Insufficient sales data for tomorrow&apos;s prediction. Keep logging sales!
                   </div>
                 )}
               </div>
            </div>
          )}

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center italic">
              <Scale className="w-5 h-5 mr-2 text-indigo-600" />
              Registered Recipes
            </h3>
            <div className="space-y-3">
              {recipes.map((r) => (
                <div key={r.id} className="p-4 border border-gray-50 rounded-2xl hover:border-indigo-100 transition-all group cursor-pointer hover:bg-indigo-50/10">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-800 text-sm group-hover:text-indigo-600 transition-colors">{r.menu_item}</span>
                    <span className="text-[10px] font-black text-gray-400 uppercase">{r.ingredients.length} Items</span>
                  </div>
                </div>
              ))}
              {recipes.length === 0 && !isLoading && (
                <p className="text-center text-xs text-gray-400 italic py-8">No recipes defined. Start building your menu intelligence.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
