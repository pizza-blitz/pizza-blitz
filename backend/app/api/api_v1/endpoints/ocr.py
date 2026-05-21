from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.api.deps import get_db
import base64, json, os

router = APIRouter()

@router.post("/scan-bill")
async def scan_bill(file: UploadFile = File(...), db: Session = Depends(get_db)):
    image_bytes = await file.read()
    image_base64 = base64.b64encode(image_bytes).decode()
    
    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
    model = genai.GenerativeModel("gemini-1.5-flash")
    
    prompt = """Extract all inventory items from this bill or photo.
    Return ONLY a JSON array like this:
    [{"item_name":"cheese","quantity":10,"unit":"kg","price_per_unit":500,"total_price":5000}]
    If any field is unclear use null. Return only the JSON array, nothing else."""
    
    import PIL.Image
    import io
    image = PIL.Image.open(io.BytesIO(image_bytes))
    response = model.generate_content([prompt, image])
    
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    
    items = json.loads(raw.strip())
    
    updated = []
    for item in items:
        if item.get("item_name") and item.get("quantity"):
            db.execute(text("""
                INSERT INTO inventory_items (name, quantity, unit, cost_per_unit, last_updated)
                VALUES (:name, :qty, :unit, :cost, NOW())
                ON CONFLICT (name) DO UPDATE
                SET quantity = inventory_items.quantity + EXCLUDED.quantity,
                    cost_per_unit = EXCLUDED.cost_per_unit,
                    last_updated = NOW()
            """), {
                "name": item["item_name"],
                "qty": float(item["quantity"]),
                "unit": item.get("unit") or "units",
                "cost": float(item.get("price_per_unit") or 0)
            })
            updated.append(item["item_name"])
    db.commit()
    
    return {
        "extracted_items": items,
        "updated_inventory": updated,
        "total_items_found": len(items)
    }
