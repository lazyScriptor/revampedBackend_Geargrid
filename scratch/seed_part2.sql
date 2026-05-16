USE geargrid_tenant_template;
SET FOREIGN_KEY_CHECKS = 0;

-- Password hash = same as admin@myrental.com (password: whatever admin uses)
SET @pw = '$2b$12$wrYe5FjRVMnn.VMaQbpuTOukGwImwJOptX.x.stnBuZTI9KE3W1Jy';

-- ── USERS (13–22) ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO USERS
  (user_id, warehouse_id, username, email, password_hash, first_name, last_name, nic_no, phone_number, address_line1, is_active, createdAt, updatedAt)
VALUES
(13,1,'sarath.kumara',    'sarath@geargridseed.lk',   @pw,'Sarath',    'Kumara',       '198845678901','0777 123 001','14A Galle Rd, Colombo 03',1,NOW(),NOW()),
(14,1,'priyanka.sena',    'priyanka@geargridseed.lk', @pw,'Priyanka',  'Senanayake',   '199156789012','0771 234 002','22 Duplication Rd, Colombo 04',1,NOW(),NOW()),
(15,2,'dilnath.jay',      'dilnath@geargridseed.lk',  @pw,'Dilnath',   'Jayawardena',  '198867890123','0768 345 003','55 Peradeniya Rd, Kandy',1,NOW(),NOW()),
(16,3,'rashmi.fern',      'rashmi@geargridseed.lk',   @pw,'Rashmi',    'Fernando',     '199278901234','0765 456 004','8 Wakwella Rd, Galle',1,NOW(),NOW()),
(17,1,'kasun.perera',     'kasun.p@geargridseed.lk',  @pw,'Kasun',     'Perera',       '199389012345','0762 567 005','33 Hospital Rd, Colombo 10',1,NOW(),NOW()),
(18,2,'amali.wick',       'amali@geargridseed.lk',    @pw,'Amali',     'Wickramasinghe','199490123456','0759 678 006','17 Dalada Veediya, Kandy',1,NOW(),NOW()),
(19,4,'niroshan.ban',     'niroshan@geargridseed.lk', @pw,'Niroshan',  'Bandara',      '199501234567','0756 789 007','44 Negombo Rd, Negombo',1,NOW(),NOW()),
(20,4,'tharaka.silva',    'tharaka@geargridseed.lk',  @pw,'Tharaka',   'Silva',        '198612345678','0753 890 008','12 Puttalam Rd, Kurunegala',1,NOW(),NOW()),
(21,5,'lahiru.rath',      'lahiru@geargridseed.lk',   @pw,'Lahiru',    'Rathnayake',   '199723456789','0750 901 009','88 Main St, Kurunegala',1,NOW(),NOW()),
(22,1,'chamari.gun',      'chamari@geargridseed.lk',  @pw,'Chamari',   'Gunasekara',   '199834567890','0747 012 010','5 Flower Rd, Colombo 07',1,NOW(),NOW());

-- ── USER ROLES ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO USER_ROLEs (user_id, role_id) VALUES
(13,1),(14,2),(15,2),(16,2),(17,3),(18,3),(19,3),(20,2),(21,2),(22,3);

-- ── CUSTOMERS (13–52) ─────────────────────────────────────────────────────────
INSERT IGNORE INTO CUSTOMERS
  (customer_id, customer_type, company_name, nic_number, first_name, last_name,
   phone_number, address_line1, is_id_retained_currently, deposit_balance, rating, status, createdAt, updatedAt)
VALUES
-- Individual
(13,'Individual',NULL,'199401234567','Sunil',    'Rajapaksa',   '0711 001 101','45 Flower Rd, Colombo 7',0,  5000,5,'Active',  NOW(),NOW()),
(14,'Individual',NULL,'198902345678','Nalinda',   'Gamage',      '0712 002 102','12 Hill St, Kandy',      0,     0,5,'Active',  NOW(),NOW()),
(15,'Individual',NULL,'199513456789','Chamila',   'Herath',      '0713 003 103','7 Beach Rd, Galle',      0, 15000,4,'Active',  NOW(),NOW()),
(16,'Individual',NULL,'198724567890','Dushmantha','Wijesinghe',  '0714 004 104','88 Main St, Negombo',    0,     0,5,'Active',  NOW(),NOW()),
(17,'Individual',NULL,'199335678901','Ruchira',   'Fonseka',     '0715 005 105','33 Lake Rd, Colombo 2',  0,  8000,5,'Active',  NOW(),NOW()),
(18,'Individual',NULL,'198946789012','Sampath',   'Kumara',      '0716 006 106','22 High Level Rd, Col 6',0,     0,4,'Active',  NOW(),NOW()),
(19,'Individual',NULL,'199457890123','Buddhika',  'Dissanayake', '0717 007 107','11 Galle Rd, Moratuwa',  0,     0,5,'Active',  NOW(),NOW()),
(20,'Individual',NULL,'199068901234','Preethika', 'Jayasundara', '0718 008 108','55 Kandy Rd, Kadawatha', 0,  2500,5,'Active',  NOW(),NOW()),
(21,'Individual',NULL,'199179012345','Manjula',   'Bandara',     '0719 009 109','19 New Town, Kurunegala',0,     0,3,'Active',  NOW(),NOW()),
(22,'Individual',NULL,'199280123456','Hiroshi',   'Pathirana',   '0720 010 110','6 Temple Rd, Kelaniya',  0,     0,5,'Active',  NOW(),NOW()),
(23,'Individual',NULL,'198891234567','Kavindra',  'Perera',      '0721 011 111','78 Old Rd, Panadura',    0, 10000,5,'Active',  NOW(),NOW()),
(24,'Individual',NULL,'199502345678','Lasith',    'Malinga',     '0722 012 112','14 Matara Rd, Galle',    0,     0,5,'Active',  NOW(),NOW()),
(25,'Individual',NULL,'198913456789','Dilshan',   'Seneviratne', '0723 013 113','9 Hospital Rd, Kegalle', 0,  3000,4,'Active',  NOW(),NOW()),
(26,'Individual',NULL,'199524567890','Gimhani',   'Rajapaksa',   '0724 014 114','37 Park Rd, Colombo 5',  0,     0,5,'Active',  NOW(),NOW()),
(27,'Individual',NULL,'198835678901','Pradeep',   'Wickramasinghe','0725 015 115','50 Buthpitiya Rd, Col', 0,     0,5,'Active',  NOW(),NOW()),
(28,'Individual',NULL,'199146789012','Thilini',   'Cooray',      '0726 016 116','3 Lotus Rd, Nugegoda',   0,  7500,5,'Active',  NOW(),NOW()),
(29,'Individual',NULL,'199757890123','Roshan',    'Jayawardena', '0727 017 117','41 Nupe Rd, Matara',     0,     0,4,'Active',  NOW(),NOW()),
(30,'Individual',NULL,'198568901234','Nadeeka',   'Dissanayake', '0728 018 118','77 Sea St, Negombo',     0,     0,1,'Blacklisted',NOW(),NOW()),
(31,'Individual',NULL,'199479012345','Damith',    'Siriwardena', '0729 019 119','22 Pettah, Colombo 11',  1, 12000,4,'Active',  NOW(),NOW()),
(32,'Individual',NULL,'199880123456','Ishara',    'Madushan',    '0730 020 120','64 Union Pl, Colombo 2', 0,     0,5,'Active',  NOW(),NOW()),
(33,'Individual',NULL,'199291234567','Dimuth',    'Karunaratne', '0731 021 121','18 Racecourse Rd, Col 7',0,  5000,5,'Active',  NOW(),NOW()),
(34,'Individual',NULL,'199002345678','Chamika',   'Gunasekara',  '0732 022 122','55 Maradana Rd, Col 10', 0,     0,5,'Active',  NOW(),NOW()),
(35,'Individual',NULL,'198713456789','Eranga',    'Thirimanne',  '0733 023 123','30 Dutugemunu St, Morat',0,     0,4,'Active',  NOW(),NOW()),
(36,'Individual',NULL,'199124567890','Dinusha',   'Jayawickreme','0734 024 124','12 Kirula Rd, Col 5',    0,  4000,5,'Active',  NOW(),NOW()),
(37,'Individual',NULL,'199835678901','Sithmi',    'Wanasinghe',  '0735 025 125','88 Negombo Rd, Ja-Ela',  0,     0,5,'Active',  NOW(),NOW()),
(38,'Individual',NULL,'199646789012','Pubudu',    'Dissanayake', '0736 026 126','7 Sri Sanghabodhi Mw',   0, 20000,5,'Active',  NOW(),NOW()),
(39,'Individual',NULL,'198457890123','Pathmanathan','Kumara',    '0737 027 127','55 Jaffna Rd, Vavuniya',  0,     0,4,'Active',  NOW(),NOW()),
(40,'Individual',NULL,'199968901234','Krishanthi', 'Balakrishnan','0738 028 128','19 Hospital Rd, Jaffna', 0,  1000,5,'Active',  NOW(),NOW()),
(41,'Individual',NULL,'199079012345','Sajeewa',   'Rajapaksa',   '0739 029 129','44 Marine Dr, Colombo 3',0,     0,3,'Active',  NOW(),NOW()),
(42,'Individual',NULL,'199680123456','Anoja',     'Thilakarathna','0740 030 130','11 High St, Trincomalee',0,     0,5,'Active',  NOW(),NOW()),
-- Business
(43,'Business','Lanka Construction (Pvt) Ltd',  'LC-BIZ-001','Harsha',   'Kumara',    '0117 001 201','250 Union Pl, Colombo 2',   0, 50000,5,'Active',NOW(),NOW()),
(44,'Business','Metro Builders (Pvt) Ltd',      'MB-BIZ-002','Chaminda', 'Rodrigo',   '0112 002 202','18 Galle Rd, Colombo 3',    0, 30000,4,'Active',NOW(),NOW()),
(45,'Business','SL Infrastructure Projects Ltd','SL-BIZ-003','Sudath',   'Jayasena',  '0114 003 203','77 Independence Ave, Col 7', 0, 75000,5,'Active',NOW(),NOW()),
(46,'Business','Colombo Event Solutions',       'CE-BIZ-004','Priyanka', 'Weeratunga','0115 004 204','12 Flower Rd, Col 7',        0,  5000,4,'Active',NOW(),NOW()),
(47,'Business','Janaka & Sons Hardware',        'JS-BIZ-005','Janaka',   'Pathirana', '0342 005 205','88 Main St, Kurunegala',     0, 10000,5,'Active',NOW(),NOW()),
(48,'Business','Southern Engineers Ltd',        'SE-BIZ-006','Nimal',    'Fernando',  '0912 006 206','22 Galle Rd, Galle',         0, 25000,5,'Active',NOW(),NOW()),
(49,'Business','Apex Construction Group',       'AC-BIZ-007','Tissa',    'Premaratne','0112 007 207','45 Bauddhaloka Mw, Col 7',   0, 40000,5,'Active',NOW(),NOW()),
(50,'Business','Nordic Ceylon (Pvt) Ltd',       'NC-BIZ-008','Kasuni',   'Samarawickrama','0117 008 208','33 Ward Pl, Col 7',      0, 15000,4,'Active',NOW(),NOW()),
(51,'Business','Peradeniya Tech Solutions',     'PT-BIZ-009','Prasad',   'Bandaranayake','0812 009 209','99 Peradeniya Rd, Kandy', 0, 20000,5,'Active',NOW(),NOW()),
(52,'Business','Royal Structures (Pvt) Ltd',    'RS-BIZ-010','Dhammika', 'Amaratunga','0117 010 210','14 Reid Ave, Colombo 7',     0, 60000,5,'Active',NOW(),NOW());

SET FOREIGN_KEY_CHECKS = 1;
