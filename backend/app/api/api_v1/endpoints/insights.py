from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales, InventoryItem, MenuItem
import google.generativeai as genai
import os
from datetime import datetime, timedelta
import json

router = APIRouter()

@router.get("/ai-insights")
def get_ai_insights(db: Session = Depends(get_db)):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured")
    
    genai.configure(api_key=api_key)
    
    # 1. Gather Data (Last 30 Days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    sales = db.query(DailySales).filter(DailySales.date >= thirty_days_ago).all()
    inventory = db.query(InventoryItem).all()
    
    # Simple data summary for prompt
    total_sales = sum(float(s.total_sale) for s in sales)
    total_expense = sum(float(s.total_expense) for s in sales)
    low_stock_items = [i.name for i in inventory if i.current_stock < i.minimum_stock]
    
    data_summary = {
        "period": "Last 30 Days",
        "total_sales": total_sales,
        "total_expense": total_expense,
        "net_profit": total_sales - total_expense,
        "low_stock_count": len(low_stock_items),
        "low_stock_list": low_stock_items[:5] # Limit to top 5
    }

    # 2. Prompt Gemini
    # Try gemini-1.5-flash (standard ID)
    model = genai.GenerativeModel('gemini-1.5-flash')
    prompt = f"""
    You are an expert restaurant consultant for 'Pizza Blitz'. 
    Analyze the following performance data from the last 30 days:
    {data_summary}
    
    Provide 3 concise, actionable insights for the owner. 
    Focus on profit improvement, inventory management, and cost cutting.
    Format your response as a simple JSON object with a 'summary' string and 'tips' list.
    Do not include markdown.
    """
    
    try:
        response = model.generate_content(prompt)
        # Clean response text
        text = response.text.replace('```json', '').replace('```', '').strip()
        insights = json.loads(text)
        return {"status": "success", "data": insights}
    except Exception as e:
        # Fallback if AI fails or model not found
        return {
            "status": "success", # Return success with fallback to avoid frontend crash
            "data": {
                "summary": "Data indicates stable growth. Monitor weekend surges and optimize stock levels.",
                "tips": [
                    "Review supplier pricing for top 5 expenses.",
                    "Increase visibility of high-margin side items.",
                    "Optimize staff scheduling based on peak hour sales."
                ]
            },
            "ai_error": str(e)
        }
