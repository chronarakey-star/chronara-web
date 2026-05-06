"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../utils/supabase";

interface InventoryModuleProps {
  companyId: string;
  storeId: string;
  themeColor: string;
  setActiveModule: (module: string) => void;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  track_inventory: boolean;
  is_package?: boolean;
}

export default function InventoryModule({ companyId, storeId, themeColor, setActiveModule }: InventoryModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"All Types" | "Normal" | "Service" | "Packaged">("All Types");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchInventory = async () => {
      if (!companyId) return;
      setIsLoading(true);

      try {
        // 1. Fetch products
        let query = supabase
          .from('products')
          .select('id, sku, name, category, price, quantity, track_inventory, store_id')
          .eq('company_id', companyId)
          .neq('is_deleted', true);

        // Store Filtering
        if (storeId && storeId !== "ALL_STORES") {
          query = query.or(`store_id.eq.${storeId},store_id.is.null`);
        }

        // Search text filtering
        if (searchQuery.trim()) {
          const safeQuery = searchQuery.trim().replace(/"/g, '""');
          query = query.or(`name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%,category.ilike.%${safeQuery}%`);
        }

        // Limit to prevent crashing on massive databases (pagination can be added later if needed)
        query = query.order('name', { ascending: true }).limit(300);

        const { data: prods, error } = await query;
        if (error) throw error;

        let processedProds = prods || [];

        // 2. Aggregate quantities for ALL_STORES mode
        if (storeId === "ALL_STORES") {
          const grouped = new Map<string, any>();
          processedProds.forEach(p => {
            const key = p.sku || p.id; // Fallback to ID if SKU is missing
            if (!grouped.has(key)) {
              grouped.set(key, { ...p });
            } else {
              const existing = grouped.get(key);
              existing.quantity = (Number(existing.quantity) || 0) + (Number(p.quantity) || 0);
            }
          });
          processedProds = Array.from(grouped.values());
        }

        // 3. Determine if items are packaged
        const skus = processedProds.map(p => p.sku).filter(Boolean);
        const packagedSkus = new Set<string>();

        if (skus.length > 0) {
          const { data: ings } = await supabase
            .from('product_ingredients')
            .select('parent_sku')
            .eq('company_id', companyId)
            .in('parent_sku', skus)
            .neq('is_deleted', true);

          if (ings) {
            ings.forEach(i => packagedSkus.add(i.parent_sku));
          }
        }

        // 4. Map final fields and apply Product Type Filter
        let finalProducts: Product[] = processedProds.map(p => ({
          ...p,
          is_package: packagedSkus.has(p.sku),
          track_inventory: p.track_inventory === 1 || p.track_inventory === true
        }));

        if (filterType === "Normal") {
          finalProducts = finalProducts.filter(p => p.track_inventory && !p.is_package);
        } else if (filterType === "Service") {
          finalProducts = finalProducts.filter(p => !p.track_inventory && !p.is_package);
        } else if (filterType === "Packaged") {
          finalProducts = finalProducts.filter(p => p.is_package);
        }

        setProducts(finalProducts);
      } catch (err) {
        console.error("Failed to fetch inventory", err);
      } finally {
        setIsLoading(false);
      }
    };

    // Debounce the search query to avoid spamming Supabase
    const timeoutId = setTimeout(fetchInventory, 300);
    return () => clearTimeout(timeoutId);
  }, [companyId, storeId, searchQuery, filterType]);

  return (
    <div className="flex flex-col h-full w-full bg-[#181818] p-8 pl-10 pr-10">
      
      {/* --- HEADER --- */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-[28px] text-white font-bold tracking-wide">
            Inventory Management
            {storeId === "ALL_STORES" && <span className="text-gray-400 text-xl ml-2 font-normal">(All Stores)</span>}
          </h1>
        </div>
        <button 
          onClick={() => setActiveModule("Dashboard")}
          className="px-6 py-2 border border-gray-600 rounded text-[14px] font-bold text-gray-300 hover:bg-[#2a2a2a] hover:text-white transition-colors"
        >
          Dashboard
        </button>
      </div>

      {/* --- SEARCH & FILTERS --- */}
      <div className="flex flex-col gap-4 mb-6">
        <input 
          type="text" 
          placeholder="Search by Name, SKU or Category..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ "--focus-color": themeColor } as React.CSSProperties}
          className="w-full bg-[#1e1e1e] border border-gray-700 p-4 rounded-xl text-[15px] text-white outline-none focus:[border-color:var(--focus-color)] transition-colors"
        />

        <div className="flex items-center gap-3">
          <label className="text-[13px] font-bold text-gray-300">Product Type:</label>
          <div className="relative">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="bg-[#1e1e1e] border border-gray-700 text-white text-[13px] font-medium rounded px-3 py-1.5 outline-none appearance-none pr-8 cursor-pointer focus:border-gray-500 transition-colors"
            >
              <option value="All Types">All Types</option>
              <option value="Normal">Normal</option>
              <option value="Service">Service</option>
              <option value="Packaged">Packaged</option>
            </select>
            {/* Custom dropdown arrow */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* --- INVENTORY LIST --- */}
      <div className="flex-1 overflow-y-auto scrollbar-hide pr-2">
        {isLoading ? (
          <p className="text-gray-500 text-center mt-10 italic text-[15px]">Loading inventory...</p>
        ) : products.length === 0 ? (
          <p className="text-gray-500 text-center mt-10 italic text-[15px]">No items found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {products.map(p => {
              
              // Determine logic for QTY and Color (Matching Python exact styling)
              let qtyText = `Qty: ${Number(p.quantity || 0)}`;
              let stockColor = themeColor; 

              if (!p.track_inventory) {
                qtyText = p.is_package ? "Packaged" : "Service";
                stockColor = "#9ca3af"; // gray-400
              } else {
                const qty = Number(p.quantity || 0);
                if (qty <= 0) stockColor = "#C92C2C"; // Delete/Red color
                else if (qty < 5) stockColor = "#E8AA15"; // Warning/Yellow color
                
                if (storeId === "ALL_STORES") {
                  qtyText = `Total Qty: ${qty}`;
                }
              }

              return (
                <div 
                  key={p.id} 
                  className="bg-[#222222] p-4 rounded-xl border border-transparent hover:border-gray-700 transition-colors flex flex-col justify-center"
                >
                  <span className="font-bold text-[16px] text-gray-100 mb-1">{p.name}</span>
                  
                  <div className="flex items-center gap-3 text-[14px] font-medium" style={{ color: stockColor }}>
                    <span>{qtyText}</span>
                    <span className="text-gray-600 opacity-50">|</span>
                    <span>Price: ${Number(p.price || 0).toFixed(2)}</span>
                    <span className="text-gray-600 opacity-50">|</span>
                    <span>SKU: {p.sku || 'N/A'}</span>
                    {p.category && (
                      <>
                        <span className="text-gray-600 opacity-50">|</span>
                        <span>{p.category}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}