USE geargrid_tenant_template;
SET FOREIGN_KEY_CHECKS = 0;

-- ── DEFECT LOGS ───────────────────────────────────────────────────────────────
-- assigned_technician_id: 9=techuser1, 17=kasun, 18=amali, 22=chamari
INSERT IGNORE INTO DEFECT_LOGS
  (log_id, equipment_id, reported_on_invoice_id, assigned_technician_id,
   defective_quantity, pending_quantity, repaired_quantity,
   defect_description, repair_status, reported_date, resolved_date)
VALUES
(17,47,NULL,17, 1,1,0,'Drum motor seized during concrete pour – will not rotate', 'In Repair','2026-03-15',NULL),
(18,48,28,  9,  1,0,1,'Blade guard cracked, replaced guard and re-torqued blade',  'Resolved',  '2025-12-19','2026-01-02'),
(19,53,NULL,22,10,10,0,'Visors missing on 10 helmets – returned from site event',   'Pending Assignment','2026-04-05',NULL),
(20,51,NULL,17, 1,1,0,'Electrode holder cable frayed near plug, creating arc hazard','In Repair','2026-04-10',NULL),
(21,57,NULL,18, 1,0,1,'Hoist gearbox oil leak – replaced seal, load test passed',   'Resolved',  '2026-02-28','2026-03-10'),
(22,59,NULL, 9, 1,1,0,'Engine vibration abnormal, carb rebuild in progress',         'In Repair','2026-04-20',NULL),
(23,33,28,  22, 4,2,2,'4 frames have bent cross-braces from overstacking',           'Partially Resolved','2026-01-10',NULL),
(24,55,NULL,17,10,10,0,'Cones melted/deformed from heat exposure on road site',      'Pending Assignment','2026-05-01',NULL),
(25,47,NULL,18, 1,0,1,'Mixing blades worn – replaced with OEM set',                  'Resolved',  '2026-03-01','2026-03-12'),
(26, 2,NULL, 9, 1,1,0,'Disc guard damaged, grinding disc wobble – under assessment', 'Pending Assignment','2026-05-08',NULL),
(27,63,NULL,22, 1,1,0,'Pump impeller cavitating, making knocking noise at 30Hz',    'In Repair','2026-04-28',NULL),
(28,39,NULL,17, 2,2,0,'Rope locks on extension mechanism jammed, unsafe to extend',  'Pending Assignment','2026-05-05',NULL),
(29,54,NULL,18, 3,3,0,'3 harness D-rings show corrosion, failing load inspection',   'In Repair','2026-05-09',NULL),
(30,38,37,  9,  1,0,1,'Breaker chisel tip fractured, replaced with hardened set',    'Resolved',  '2026-02-11','2026-02-20'),
(31,34,35, 22,  5,5,0,'5 steel planks have weld cracks at joint, need re-weld',      'In Repair','2026-01-30',NULL),
(32,61,NULL,17, 1,1,0,'Mobile tower baseplate wheel lock broken, wheel free-rolls',  'Pending Assignment','2026-05-13',NULL);

-- ── EXPENSES ──────────────────────────────────────────────────────────────────
INSERT IGNORE INTO EXPENSES
  (expense_id, category, amount, date, description, recorded_by_user_id, warehouse_id)
VALUES
-- Operational
(1,'Operational',  45000,'2025-11-05','Monthly vehicle fuel – delivery fleet, Colombo',        1,1),
(2,'Operational',  18500,'2025-11-15','Telephone & internet bill – November',                   1,1),
(3,'Operational',  12000,'2025-12-02','Staff uniforms and safety gear restock',                 14,1),
(4,'Operational',  65000,'2025-12-10','Generator maintenance service – 3 units at HQ',         1,1),
(5,'Operational',  22000,'2026-01-07','Office supplies and stationery – Q1',                    14,1),
(6,'Operational',  38000,'2026-01-15','Monthly vehicle fuel – all branches',                    15,2),
(7,'Operational',  15500,'2026-01-20','Electricity bill – Colombo warehouse January',           1,1),
(8,'Operational',  28000,'2026-02-03','Scaffolding transport hire – Galle site delivery',       16,3),
(9,'Operational',  19000,'2026-02-14','CCTV maintenance and DVR hard drive replacement',        14,1),
(10,'Operational', 55000,'2026-03-01','Monthly vehicle fuel and toll charges – all branches',   1,1),
(11,'Operational', 14000,'2026-03-10','Staff mobile phones data plan – 7 numbers',              14,1),
(12,'Operational', 42000,'2026-04-02','Electricity bills – all 4 warehouses April',             1,1),
(13,'Operational', 25000,'2026-04-15','Insurance premium – annual policy instalment Q2',        13,1),
(14,'Operational', 17500,'2026-05-01','Warehouse cleaning and pest control – HQ',               14,1),
(15,'Operational', 33000,'2026-05-10','Vehicle fuel – driver wages and overtime',               1,1),
-- Repair
(16,'Repair',      28500,'2025-11-20','Concrete mixer 350L gearbox rebuild – external workshop',1,1),
(17,'Repair',      12000,'2025-12-01','Scaffolding frame sand-blasting and repainting – batch 20',22,1),
(18,'Repair',       8500,'2026-01-10','Generator AVR replacement – Perkins unit',               17,1),
(19,'Repair',      35000,'2026-01-25','Plate compactor engine overhaul – pistons and rings',    9,1),
(20,'Repair',      15000,'2026-02-08','Welding machine transformer rewind – Arc Welder #3',     17,1),
(21,'Repair',      22000,'2026-02-20','Hydraulic hose replacement – mini excavator',            9,1),
(22,'Repair',       9500,'2026-03-15','Chain hoist motor brush replacement',                    18,1),
(23,'Repair',      18000,'2026-04-05','Compressor pressure valve replacement + service',        17,1),
(24,'Repair',      31000,'2026-04-22','Lawnmower engine head gasket and blade sharpening',      22,3),
(25,'Repair',      14500,'2026-05-03','Submersible pump impeller replacement – 2 units',        9,1),
-- Asset Purchase
(26,'Asset Purchase',185000,'2025-11-01','Bosch Rotary Hammer SDS+ 36V – new unit',            1,2),
(27,'Asset Purchase',125000,'2025-11-01','Makita Circular Saw 7.25" – new unit',               1,2),
(28,'Asset Purchase',850000,'2026-01-10','Perkins 25kVA Silent Generator – warehouse expansion',1,1),
(29,'Asset Purchase',195000,'2026-01-10','Honda 5.5kVA Generator (x2 units)',                  1,1),
(30,'Asset Purchase', 95000,'2026-02-15','Concrete Cutter 14" – Kandy branch fleet',           15,2),
(31,'Asset Purchase', 75000,'2026-03-05','Husqvarna Chainsaw 445 – Galle depot',               16,3),
(32,'Asset Purchase',125000,'2026-03-05','Rotary Tiller 5.5HP – Galle depot',                  16,3),
(33,'Asset Purchase', 22000,'2026-04-01','Hedge Trimmer Set x3 – replacement stock',            16,3),
(34,'Asset Purchase', 85000,'2026-04-15','Mobile Tower 1.4m (x5 additional units)',             15,2),
-- Other
(35,'Other',        5000,'2025-12-20','Customer damage deposit refund – partial refund',        1,1),
(36,'Other',       12000,'2026-01-05','Promotional banner printing – New Year campaign',       14,1),
(37,'Other',        8000,'2026-02-01','Staff appreciation dinner – Q4 2025',                    13,1),
(38,'Other',       15000,'2026-03-20','Trade show participation fee – CINTAA Sri Lanka',       13,1),
(39,'Other',        3500,'2026-04-10','Bank charges and transfer fees – Q1',                    1,1),
(40,'Other',       25000,'2026-05-01','Legal fees – lease agreement renewal, Kandy branch',    13,1);

-- ── INVOICE TRACES ────────────────────────────────────────────────────────────
INSERT IGNORE INTO INVOICE_TRACE
  (trace_id, invoice_id, actor_user_id, event_category, event_action,
   entity_reference_id, state_payload, comments, occurred_at, createdAt, updatedAt)
VALUES
(1, 22,1, 'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Order dispatched to site Colombo 7', '2025-11-03',NOW(),NOW()),
(2, 22,1, 'PAYMENT',   'PAYMENT_RECEIVED',      NULL, NULL, 'Advance payment Rs.20000 Cash',      '2025-11-03',NOW(),NOW()),
(3, 22,1, 'RETURN',    'RETURN_PROCESSED',      NULL, NULL, 'All items returned in good condition','2025-11-08',NOW(),NOW()),
(4, 22,1, 'PAYMENT',   'PAYMENT_RECEIVED',      NULL, NULL, 'Balance Rs.35600 Card',              '2025-11-08',NOW(),NOW()),
(5, 24,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Large site equipment dispatched',     '2025-11-15',NOW(),NOW()),
(6, 24,14,'PAYMENT',   'PAYMENT_RECEIVED',      NULL, NULL, 'Advance Rs.100000 Bank Transfer',    '2025-11-15',NOW(),NOW()),
(7, 28,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Dispatched to SL Infra Mattegoda site','2025-12-05',NOW(),NOW()),
(8, 28, 9,'DEFECT',    'DEFECT_REPORTED',       NULL, NULL, 'Blade guard cracked on concrete cutter','2025-12-19',NOW(),NOW()),
(9, 28,14,'RETURN',    'RETURN_PROCESSED',      NULL, NULL, 'All returned – 1 defective concrete cutter','2025-12-19',NOW(),NOW()),
(10,42,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Generator + helmets to Colombo event site','2026-04-01',NOW(),NOW()),
(11,43,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Compactor + towers to Apex site',    '2026-04-05',NOW(),NOW()),
(12,45,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Heavy equipment dispatched – SL Infra','2026-04-12',NOW(),NOW()),
(13,48,14,'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Full safety kit dispatched – Lanka Const','2026-04-20',NOW(),NOW()),
(14,55,1, 'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Generator dispatched with ID held',  '2026-05-05',NOW(),NOW()),
(15,61,1, 'DISPATCH',  'ORDER_CREATED',         NULL, NULL, 'Scaffolding dispatched – not returned yet (OVERDUE)','2026-04-01',NOW(),NOW());

SET FOREIGN_KEY_CHECKS = 1;
