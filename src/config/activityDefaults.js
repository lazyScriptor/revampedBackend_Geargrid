export const DEFAULT_ACTIVITY_THRESHOLDS = {
  discountHighPct: 10,
  discountHighAmount: 5000,
  backdateHighDays: 2,
  refundHighAmount: 5000,
};

export const DEFAULT_REASONS = {
  discount: [
    { key: "regular_customer", label_en: "Regular customer", label_si: "නිත්‍ය පාරිභෝගික", active: true },
    { key: "bulk_long_rental", label_en: "Bulk / long rental", label_si: "තොග / දිගු කුලිය", active: true },
    { key: "our_late_delivery", label_en: "Our late delivery", label_si: "අපගේ ප්‍රමාද බෙදාහැරීම", active: true },
    { key: "equipment_issue", label_en: "Equipment issue", label_si: "උපකරණ ගැටලුව", active: true },
    { key: "owners_instruction", label_en: "Owner's instruction", label_si: "හිමිකරුගේ උපදෙස්", active: true },
    { key: "other", label_en: "Other", label_si: "වෙනත්", active: true },
  ],
  backdate: [
    { key: "forgot_to_enter", label_en: "Forgot to enter", label_si: "ඇතුළත් කිරීමට අමතක විය", active: true },
    { key: "system_was_down", label_en: "System was down", label_si: "පද්ධතිය අක්‍රිය විය", active: true },
    { key: "entered_at_site", label_en: "Entered at the site", label_si: "වැඩබිමේදී ඇතුළත් කළේය", active: true },
    { key: "customer_paid_earlier", label_en: "Customer paid earlier", label_si: "පාරිභෝගිකයා කලින් ගෙවා ඇත", active: true },
    { key: "other", label_en: "Other", label_si: "වෙනත්", active: true },
  ],
  refund: [
    { key: "returned_early", label_en: "Returned early", label_si: "කලින් ආපසු ලබා දුන්නේය", active: true },
    { key: "overpayment", label_en: "Overpayment", label_si: "අධික ගෙවීම", active: true },
    { key: "deposit_refund", label_en: "Deposit refund", label_si: "තැන්පතු ආපසු ගෙවීම", active: true },
    { key: "cancelled_item", label_en: "Cancelled item", label_si: "අවලංගු කළ භාණ්ඩය", active: true },
    { key: "other", label_en: "Other", label_si: "වෙනත්", active: true },
  ],
  void: [
    { key: "entered_by_mistake", label_en: "Entered by mistake", label_si: "වැරදීමකින් ඇතුළත් කළේය", active: true },
    { key: "wrong_amount", label_en: "Wrong amount", label_si: "වැරදි මුදල", active: true },
    { key: "wrong_method", label_en: "Wrong method", label_si: "වැරදි ගෙවීම් ක්‍රමය", active: true },
    { key: "duplicate_entry", label_en: "Duplicate entry", label_si: "ද්විත්ව ඇතුළත් කිරීම", active: true },
    { key: "other", label_en: "Other", label_si: "වෙනත්", active: true },
  ],
};

export const DEFAULT_REVIEW_TAGS = {
  positive: [
    { key: "on_time", label_en: "On time", label_si: "නියමිත වේලාවට", active: true },
    { key: "paid_promptly", label_en: "Paid promptly", label_si: "වහාම ගෙව්වා", active: true },
    { key: "clean", label_en: "Clean", label_si: "පිරිසිදුයි", active: true },
  ],
  negative: [
    { key: "late", label_en: "Late", label_si: "ප්‍රමාදයි", active: true },
    { key: "damaged", label_en: "Damaged", label_si: "හානි වී ඇත", active: true },
    { key: "payment_delayed", label_en: "Payment delayed", label_si: "ගෙවීම ප්‍රමාදයි", active: true },
    { key: "difficult", label_en: "Difficult", label_si: "අපහසුයි", active: true },
  ],
};
