-- PIZZA BLITZ EXPANSION MIGRATIONS (2026-03-29)

-- 1. SHIFT LOGS
CREATE TABLE IF NOT EXISTS shift_log (
    id SERIAL PRIMARY KEY,
    staff_name TEXT NOT NULL,
    shift_type TEXT NOT NULL, -- 'Lunch' or 'Dinner'
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    revenue_generated DECIMAL(12,2) DEFAULT 0,
    orders_handled INTEGER DEFAULT 0,
    performance_notes TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- 2. TABLE MANAGEMENT
CREATE TABLE IF NOT EXISTS tables (
    id SERIAL PRIMARY KEY,
    table_number INTEGER UNIQUE NOT NULL,
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'available', -- 'available', 'occupied', 'reserved'
    current_order_id INTEGER
);

-- 3. ORDERS (POS)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    table_id INTEGER REFERENCES tables(id),
    order_type TEXT NOT NULL, -- 'dine-in', 'takeaway', 'delivery'
    items JSONB NOT NULL, -- [{name, quantity, price}]
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL, -- 5% GST
    total_amount DECIMAL(12,2) NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. INVOICES (GST COMPLIANCE)
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    date DATE NOT NULL,
    order_id INTEGER REFERENCES orders(id),
    customer_name TEXT,
    customer_gstin TEXT,
    items JSONB,
    subtotal DECIMAL(12,2),
    cgst DECIMAL(12,2),
    sgst DECIMAL(12,2),
    total DECIMAL(12,2) NOT NULL,
    payment_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. FIXED COSTS (BREAK-EVEN)
CREATE TABLE IF NOT EXISTS fixed_costs (
    month TEXT PRIMARY KEY, -- 'YYYY-MM'
    rent DECIMAL(12,2) DEFAULT 0,
    salaries DECIMAL(12,2) DEFAULT 0,
    utilities DECIMAL(12,2) DEFAULT 0,
    other_fixed DECIMAL(12,2) DEFAULT 0,
    avg_order_value DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. VENDORS & PRICE HISTORY
CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    whatsapp_number TEXT,
    items_supplied TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendor_price_history (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id),
    item_name TEXT NOT NULL,
    price_per_unit DECIMAL(12,2) NOT NULL,
    unit TEXT NOT NULL,
    recorded_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SEED DATA
INSERT INTO tables (table_number) VALUES (1), (2), (3), (4), (5), (6), (7), (8)
ON CONFLICT DO NOTHING;
