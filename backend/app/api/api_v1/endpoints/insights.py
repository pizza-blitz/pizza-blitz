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
        return {"status": "success", "data": insights, "ai_configured": True}
    except HTTPException as exc:
        ai_error = str(exc.detail)
    except Exception as exc:  # Fallback if the model or response fails.
        ai_error = str(exc)

    # The AI provider is optional. Without it the page must still tell the
    # owner something true, so build the guidance from the same figures the
    # model would have read instead of inventing a trend.
    summary = (
        f"Last 30 days: Rs {total_sales:,.2f} in sales and Rs {total_expense:,.2f} in "
        f"expenses, leaving Rs {total_sales - total_expense:,.2f}. "
    )
    if low_stock_items:
        summary += f"{len(low_stock_items)} inventory item(s) are below their minimum level."
    else:
        summary += "No inventory item is below its minimum level."

    tips = []
    if low_stock_items:
        names = ", ".join(low_stock_items[:3])
        tips.append(f"Reorder {names} before the next service.")
    if total_sales - total_expense <= 0:
        tips.append("Expenses match or exceed sales - review the largest expense categories in Reports.")
    else:
        tips.append("Track the margin between sales and expenses daily in Reports.")
    tips.append("Staff the busiest hours first: check the day-of-week breakdown before the next roster.")
    tips.append("Push the highest-margin side items while the peak-hours stock is confirmed.")

    return {
        "status": "fallback",
        "data": {"summary": summary, "tips": tips},
        "ai_error": ai_error,
        "ai_configured": False,
        "message": (
            "AI provider is not configured. Showing standard operating guidance "
            "calculated from your own sales and stock figures."
        ),
    }
