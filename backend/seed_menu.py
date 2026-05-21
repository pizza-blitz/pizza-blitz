import sys
import os

# Add the parent directory to sys.path to import app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.domain import MenuItem

def seed_menu():
    db: Session = SessionLocal()
    
    menu_items = [
        # PIZZA (Regular)
        {"name": "Margherita Pizza (R)", "category": "Pizza", "selling_price": 199.0, "cost_price": 80.0},
        {"name": "Margherita Pizza (M)", "category": "Pizza", "selling_price": 299.0, "cost_price": 120.0},
        {"name": "Margherita Pizza (L)", "category": "Pizza", "selling_price": 449.0, "cost_price": 180.0},
        
        {"name": "Cheese Burst Burger", "category": "Burgers", "selling_price": 149.0, "cost_price": 60.0},
        {"name": "Veggie Delight Sandwich", "category": "Sandwiches", "selling_price": 129.0, "cost_price": 50.0},
        {"name": "Cold Coffee", "category": "Beverages", "selling_price": 99.0, "cost_price": 30.0},
        {"name": "French Fries", "category": "Sides", "selling_price": 89.0, "cost_price": 25.0},
        {"name": "Farmhouse Pizza (R)", "category": "Pizza", "selling_price": 249.0, "cost_price": 100.0},
        {"name": "Garlic Bread", "category": "Sides", "selling_price": 119.0, "cost_price": 40.0},
        {"name": "Brownie", "category": "Desserts", "selling_price": 79.0, "cost_price": 20.0},
    ]
    
    try:
        for item_data in menu_items:
            # Check if exists
            item = db.query(MenuItem).filter(MenuItem.name == item_data["name"]).first()
            if not item:
                item = MenuItem(**item_data)
                db.add(item)
        
        db.commit()
        print("Menu seeded successfully!")
    except Exception as e:
        db.rollback()
        print(f"Error seeding menu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_menu()
