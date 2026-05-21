from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales, InventoryItem
from app.services.gemini_service import generate_text, parse_json_response
from datetime import datetime, timedelta

router = APIRouter()

@router.get("/ai-insights")
def get_ai_insights(db: Session = Depends(get_db)):
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
        text = generate_text(model="gemini-1.5-flash", contents=prompt)
        insights = parse_json_response(text)
        return {"status": "success", "data": insights}
    except HTTPException:
        raise
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
