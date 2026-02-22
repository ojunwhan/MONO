// src/constants/siteContexts.js — Call Sign roles per site context
const SITE_CONTEXTS = [
  {
    id: "construction",
    label: "Construction",
    labelKo: "건설 현장",
    roles: ["Manager", "Lead", "Tech", "Operator", "Safety", "Driver"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    labelKo: "제조 현장",
    roles: ["Manager", "Lead", "Tech", "Operator", "QC", "Maintenance"],
  },
  {
    id: "logistics",
    label: "Logistics / Warehouse",
    labelKo: "물류 / 창고",
    roles: ["Manager", "Lead", "Operator", "Driver", "Picker", "Loader"],
  },
  {
    id: "medical",
    label: "Medical",
    labelKo: "의료",
    roles: ["Doctor", "Nurse", "Tech", "Admin", "Paramedic"],
  },
  {
    id: "airport_event",
    label: "Airport / Event",
    labelKo: "공항 / 이벤트",
    roles: ["Manager", "Lead", "Security", "Operator", "Guide"],
  },
  {
    id: "general",
    label: "General",
    labelKo: "일반",
    roles: ["Manager", "Lead", "Tech", "Operator", "Staff"],
  },
];

export default SITE_CONTEXTS;
