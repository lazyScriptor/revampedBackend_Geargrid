USE geargrid_tenant_template;
SET FOREIGN_KEY_CHECKS = 0;

-- ── WAREHOUSES ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO WAREHOUSES (warehouse_id, location_name, address, contact_number) VALUES
(2, 'Kandy Branch',       '145 Peradeniya Road, Kandy',      '0812 234 567'),
(3, 'Galle Outpost',      '38 Wakwella Road, Galle Fort',    '0912 345 678'),
(4, 'Negombo Depot',      '67 Chilaw Road, Negombo',         '0312 456 789'),
(5, 'Kurunegala Center',  '22 Puttalam Road, Kurunegala',    '0372 567 890');

-- ── CATEGORIES ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO EQUIPMENT_CATEGORIES (category_id, category_name, category_description) VALUES
(3,  'Earthmoving Equipment', 'Compactors, graders and site prep equipment'),
(4,  'Lifting & Rigging',     'Chain hoists, block tackles and rigging accessories'),
(5,  'Generators & Power',    'Portable and standby generators'),
(6,  'Air Compressors',       'Portable and stationary air compressors'),
(7,  'Concrete Equipment',    'Mixers, vibrators and concrete finishing tools'),
(8,  'Welding Equipment',     'MIG, ARC and plasma cutting machines'),
(9,  'Safety & PPE',          'Hard hats, harnesses and site safety gear'),
(10, 'Scaffolding & Access',  'Mobile towers, frames and access platforms'),
(11, 'Plumbing & Drainage',   'Pumps, pipe tools and drainage equipment'),
(12, 'Landscaping & Garden',  'Outdoor power tools for site landscaping');

-- ── EQUIPMENT (42–71) ────────────────────────────────────────────────────────
INSERT IGNORE INTO EQUIPMENT
  (equipment_id, category_id, warehouse_id, is_bulk_item, equipment_name, serial_number,
   total_owned_qty, available_qty, rented_qty, defective_qty,
   purchase_cost, base_rental_price, minimum_rental_days, extra_daily_rate,
   warranty_period_months, end_of_warranty_date, createdAt, updatedAt)
VALUES
(42, 5,1,0,'Perkins 25kVA Silent Generator',    'PKN-25-001',  1, 0,1,0, 850000, 8000,1,2500,24,'2026-12-31',NOW(),NOW()),
(43, 5,1,0,'Honda 5.5kVA Portable Generator',   'HND-55-002',  2, 1,1,0, 195000, 4500,1,1500,12,'2026-06-30',NOW(),NOW()),
(44, 5,2,0,'Yamaha 3kVA Inverter Generator',    'YMH-3K-003',  1, 1,0,0, 145000, 3000,1,1000,12,'2026-09-30',NOW(),NOW()),
(45, 6,1,0,'Atlas Copco 185CFM Compressor',     'ATC-185-004', 1, 0,1,0,1200000, 6000,1,2000,36,'2027-03-31',NOW(),NOW()),
(46, 6,2,0,'Portable Air Compressor 50L',       'PAC-50-005',  1, 1,0,0,  65000, 2500,1, 800,12,'2026-08-31',NOW(),NOW()),
(47, 7,1,1,'Concrete Mixer 350L (Diesel)',       NULL,          5, 2,2,1, 180000, 2500,3, 800,24,'2027-01-31',NOW(),NOW()),
(48, 7,1,1,'Poker Vibrator 35mm',               NULL,         10, 6,3,1,  12000, 1200,2, 400,12,'2026-10-31',NOW(),NOW()),
(49, 7,2,0,'Concrete Cutter 14"',               'CCT-14-006',  1, 0,1,0,  95000, 3000,2,1000,18,'2027-02-28',NOW(),NOW()),
(50, 8,1,0,'Lincoln MIG Welder 350A',           'LNK-350-007', 1, 0,1,0, 245000, 3500,3,1200,24,'2026-11-30',NOW(),NOW()),
(51, 8,1,1,'Arc Welder 250A',                   NULL,          8, 4,3,1,  55000, 2000,2, 700,12,'2026-07-31',NOW(),NOW()),
(52, 8,2,0,'Plasma Cutter 50A',                 'PLC-50-008',  1, 1,0,0, 185000, 4500,3,1500,18,'2027-04-30',NOW(),NOW()),
(53, 9,1,1,'Safety Helmets Class A',             NULL,        200,150,40,10,  2500,   50,1,  50, 0,NULL,      NOW(),NOW()),
(54, 9,1,1,'Full Body Safety Harness',           NULL,        100, 82,15, 3,  8500,  200,1, 200, 0,NULL,      NOW(),NOW()),
(55, 9,1,1,'Traffic Cones (Set of 10)',          NULL,        150,115,30, 5,  4500,   30,1,  30, 0,NULL,      NOW(),NOW()),
(56, 9,1,1,'Safety Barrier Board',               NULL,         50, 38,10, 2,  3500,  100,1, 100, 0,NULL,      NOW(),NOW()),
(57, 4,1,0,'Chain Hoist 3T Electric',            'CHE-3T-009', 1, 0,1,0, 320000, 4500,3,1500,24,'2027-05-31',NOW(),NOW()),
(58, 4,1,1,'Chain Block 1T Manual',              NULL,         15, 9,5,1,  18000,  800,1, 800, 0,NULL,       NOW(),NOW()),
(59, 3,1,0,'Plate Compactor Wacker WP1540',      'WPR-154-010',1, 0,1,0, 185000, 3500,1,1200,24,'2027-01-31',NOW(),NOW()),
(60, 3,2,0,'Walk-Behind Roller 700kg',           'WBR-700-011',1, 1,0,0, 280000, 5000,1,1800,24,'2026-12-31',NOW(),NOW()),
(61,10,2,1,'Mobile Tower 1.4m (Aluminium)',      NULL,         20,12,8,0,  85000, 2500,3, 800,12,'2026-06-30',NOW(),NOW()),
(62,10,1,1,'Aluminium Trestle Ladder 8ft',       NULL,         25,22,3,0,   9500,  400,1, 400, 0,NULL,       NOW(),NOW()),
(63,11,1,1,'Submersible Pump 3"',               NULL,         10, 6,3,1,  45000, 1500,1, 500,12,'2026-11-30',NOW(),NOW()),
(64,11,2,0,'Sewer Inspection Camera 30m',        'SIC-30-012', 1, 1,0,0, 420000, 5000,1,2000,24,'2027-03-31',NOW(),NOW()),
(65,11,1,0,'Pipe Threading Machine 1/2"-2"',     'PTM-22-013', 1, 1,0,0, 165000, 3000,3,1000,18,'2026-12-31',NOW(),NOW()),
(66,12,3,0,'Honda Lawnmower HRG466',             'HLM-466-014',1, 1,0,0,  95000, 2000,1, 700,24,'2027-02-28',NOW(),NOW()),
(67,12,3,0,'Husqvarna Chainsaw 445',             'HCS-445-015',1, 0,1,0,  75000, 2500,2, 900,12,'2026-08-31',NOW(),NOW()),
(68,12,3,0,'Rotary Tiller 5.5HP',               'RTC-55-016', 1, 0,1,0, 125000, 3000,3,1000,18,'2026-10-31',NOW(),NOW()),
(69,12,3,1,'Hedge Trimmer Set (Electric)',        NULL,          8, 5,2,1,  22000,  800,1, 800, 0,NULL,       NOW(),NOW()),
(70, 1,2,0,'Bosch Rotary Hammer SDS+ 36V',       'BRH-36-017', 1, 1,0,0, 185000, 2500,1, 800,24,'2027-01-31',NOW(),NOW()),
(71, 1,2,0,'Makita Circular Saw 7.25"',          'MCS-725-018',1, 1,0,0, 125000, 2000,1, 700,12,'2026-07-31',NOW(),NOW());

SET FOREIGN_KEY_CHECKS = 1;
