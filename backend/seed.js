const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Hospital = require('./models/Hospital');
const Ambulance = require('./models/Ambulance');
const User = require('./models/User');

// Hospital coordinates: [lng, lat] WGS84 — aligned to published Google Maps building pins
const hospitals = [
  {
    name: 'SMS Medical College & Hospital',
    address: 'JLN Marg, Gangawal Park',
    city: 'Jaipur', state: 'RJ', phone: '0141-2518501',
    type: 'Level 1 Trauma Center',
    capabilities: ['ICU', 'NICU', 'Cardiac', 'Neuro', 'Trauma', 'Pediatric', 'Burn Unit'],
    totalBeds: 1200, availableBeds: 210, icuBeds: 80, availableIcuBeds: 18,
    location: { type: 'Point', coordinates: [75.81362, 26.90438] }
  },
  {
    name: 'Fortis Escorts Hospital',
    address: 'Jawahar Lal Nehru Marg, Malviya Nagar',
    city: 'Jaipur', state: 'RJ', phone: '0141-2547000',
    type: 'Level 1 Trauma Center',
    capabilities: ['ICU', 'NICU', 'Cardiac', 'Trauma', 'Burn Unit', 'Neuro'],
    totalBeds: 450, availableBeds: 63, icuBeds: 35, availableIcuBeds: 11,
    location: { type: 'Point', coordinates: [75.80411, 26.84789] }
  },
  {
    name: 'Manipal Hospital Jaipur',
    address: 'Sector 6, Vidhyadhar Nagar',
    city: 'Jaipur', state: 'RJ', phone: '0141-3989999',
    type: 'Level 2 Trauma Center',
    capabilities: ['ICU', 'Cardiac', 'Neuro', 'Orthopedic', 'General Surgery'],
    totalBeds: 300, availableBeds: 42, icuBeds: 20, availableIcuBeds: 5,
    location: { type: 'Point', coordinates: [75.77992, 26.95431] }
  },
  {
    name: 'Narayana Multispeciality Hospital',
    address: 'Sector 28, Pratap Nagar',
    city: 'Jaipur', state: 'RJ', phone: '0141-4018000',
    type: 'Level 2 Trauma Center',
    capabilities: ['ICU', 'Cardiac', 'Orthopedic', 'General Surgery'],
    totalBeds: 200, availableBeds: 35, icuBeds: 15, availableIcuBeds: 4,
    location: { type: 'Point', coordinates: [75.75838, 26.80548] }
  },
  {
    name: 'Eternal Hospital',
    address: '3, Jagatpura Flyover, Jagatpura',
    city: 'Jaipur', state: 'RJ', phone: '0141-4913131',
    type: 'Level 2 Trauma Center',
    capabilities: ['ICU', 'Cardiac', 'Neuro', 'Respiratory', 'Trauma'],
    totalBeds: 250, availableBeds: 48, icuBeds: 24, availableIcuBeds: 7,
    location: { type: 'Point', coordinates: [75.87468, 26.82391] }
  },
  {
    name: 'Mahatma Gandhi Medical College & Hospital',
    address: 'RIICO Industrial Area, Sitapura',
    city: 'Jaipur', state: 'RJ', phone: '0141-2770500',
    type: 'Level 1 Trauma Center',
    capabilities: ['ICU', 'NICU', 'Burn Unit', 'Trauma', 'General Surgery', 'Pediatric'],
    totalBeds: 600, availableBeds: 120, icuBeds: 50, availableIcuBeds: 14,
    location: { type: 'Point', coordinates: [75.87344, 26.78195] }
  },
  {
    name: 'NIMS Hospital',
    address: 'Delhi–Jaipur Expy, Shobha Nagar',
    city: 'Jaipur', state: 'RJ', phone: '0141-2605010',
    type: 'Level 2 Trauma Center',
    capabilities: ['ICU', 'Cardiac', 'Neuro', 'Orthopedic'],
    totalBeds: 380, availableBeds: 55, icuBeds: 30, availableIcuBeds: 9,
    location: { type: 'Point', coordinates: [75.74225, 26.95692] }
  },
  {
    name: 'Safdarjung Hospital',
    address: 'Ansari Nagar East, Ring Road',
    city: 'New Delhi', state: 'DL', phone: '011-26707444',
    type: 'Level 1 Trauma Center',
    capabilities: ['ICU', 'NICU', 'Cardiac', 'Neuro', 'Trauma', 'Burn Unit'],
    totalBeds: 500, availableBeds: 87, icuBeds: 40, availableIcuBeds: 8,
    location: { type: 'Point', coordinates: [77.20935, 28.56865] }
  }
];

// 22 ambulances spread around Jaipur with realistic positions
const ambulanceDefs = [
  // BLS
  { unitId:'BLS-101', type:'BLS', plate:'RJ14-CA-0101', crew:[{name:'Ravi Kumar',role:'EMT'},{name:'Suresh Pal',role:'Driver'}],   coords:[75.7873,26.9124] },
  { unitId:'BLS-102', type:'BLS', plate:'RJ14-CA-0102', crew:[{name:'Pooja Meena',role:'EMT'},{name:'Dinesh Singh',role:'Driver'}],   coords:[75.8200,26.9300] },
  { unitId:'BLS-103', type:'BLS', plate:'RJ14-CA-0103', crew:[{name:'Anil Sharma',role:'EMT'},{name:'Mahesh Verma',role:'Driver'}],   coords:[75.7600,26.9000] },
  { unitId:'BLS-104', type:'BLS', plate:'RJ14-CA-0104', crew:[{name:'Rekha Jain',role:'EMT'},{name:'Govind Ram',role:'Driver'}],     coords:[75.8400,26.8900] },
  { unitId:'BLS-105', type:'BLS', plate:'RJ14-CA-0105', crew:[{name:'Sunita Rao',role:'EMT'},{name:'Bharat Lal',role:'Driver'}],     coords:[75.8650,26.9500] },
  { unitId:'BLS-106', type:'BLS', plate:'RJ14-CA-0106', crew:[{name:'Ajay Yadav',role:'EMT'},{name:'Mohan Das',role:'Driver'}],     coords:[75.7450,26.9600] },

  // ALS
  { unitId:'ALS-401', type:'ALS', plate:'RJ14-CB-0401', crew:[{name:'Dr. Kavita Joshi',role:'Paramedic'},{name:'Vijay Singh',role:'Driver'}],   coords:[75.8100,26.9050] },
  { unitId:'ALS-402', type:'ALS', plate:'RJ14-CB-0402', crew:[{name:'Medic Ross',role:'Paramedic'},{name:'Ramesh Gupta',role:'Driver'}],         coords:[75.8350,26.9200] },
  { unitId:'ALS-403', type:'ALS', plate:'RJ14-CB-0403', crew:[{name:'Priya Nair',role:'Paramedic'},{name:'Arjun Das',role:'Driver'}],            coords:[75.7750,26.9400] },
  { unitId:'ALS-404', type:'ALS', plate:'RJ14-CB-0404', crew:[{name:'Dr. Sanjay Mehta',role:'Paramedic'},{name:'Kishan Lal',role:'Driver'}],     coords:[75.8600,26.8800] },
  { unitId:'ALS-405', type:'ALS', plate:'RJ14-CB-0405', crew:[{name:'Deepa Malhotra',role:'Paramedic'},{name:'Rakesh Tomar',role:'Driver'}],     coords:[75.7900,26.8650] },
  { unitId:'ALS-406', type:'ALS', plate:'RJ14-CB-0406', crew:[{name:'Dr. Harsh Vardhan',role:'Paramedic'},{name:'Pawan Kumar',role:'Driver'}],   coords:[75.8050,26.9650] },

  // ICU
  { unitId:'ICU-201', type:'ICU', plate:'RJ14-CC-0201', crew:[{name:'Dr. Alok Mishra',role:'Paramedic'},{name:'Nurse Divya K.',role:'Nurse'},{name:'Sanjay Yadav',role:'Driver'}],     coords:[75.8450,26.9350] },
  { unitId:'ICU-202', type:'ICU', plate:'RJ14-CC-0202', crew:[{name:'Dr. Rekha Verma',role:'Paramedic'},{name:'Nurse Anita S.',role:'Nurse'},{name:'Hari Lal',role:'Driver'}],          coords:[75.7980,26.9550] },
  { unitId:'ICU-203', type:'ICU', plate:'RJ14-CC-0203', crew:[{name:'Dr. Manish Goel',role:'Paramedic'},{name:'Nurse Seema T.',role:'Nurse'},{name:'Sunil Khatri',role:'Driver'}],      coords:[75.8200,26.8700] },
  { unitId:'ICU-204', type:'ICU', plate:'RJ14-CC-0204', crew:[{name:'Dr. Anjali Shah',role:'Paramedic'},{name:'Nurse Ritu M.',role:'Nurse'},{name:'Bhola Prasad',role:'Driver'}],       coords:[75.7700,26.8950] },
  { unitId:'ICU-205', type:'ICU', plate:'RJ14-CC-0205', crew:[{name:'Dr. Vikram Rathore',role:'Paramedic'},{name:'Nurse Kavya P.',role:'Nurse'},{name:'Nathu Lal',role:'Driver'}],     coords:[75.8750,26.9150] },

  // NEONATAL
  { unitId:'NEO-301', type:'NEONATAL', plate:'RJ14-CD-0301', crew:[{name:'Dr. Sunita Rao',role:'Paramedic'},{name:'Nurse Geeta M.',role:'Nurse'},{name:'Hari Prasad',role:'Driver'}],    coords:[75.8100,26.8900] },
  { unitId:'NEO-302', type:'NEONATAL', plate:'RJ14-CD-0302', crew:[{name:'Dr. Pradeep Kumar',role:'Paramedic'},{name:'Nurse Meena T.',role:'Nurse'},{name:'Gopal Singh',role:'Driver'}], coords:[75.8300,26.9700] },
  { unitId:'NEO-303', type:'NEONATAL', plate:'RJ14-CD-0303', crew:[{name:'Dr. Nisha Agarwal',role:'Paramedic'},{name:'Nurse Poonam K.',role:'Nurse'},{name:'Ram Prakash',role:'Driver'}],coords:[75.7800,26.9300] },

  // Manipal University Jaipur (MUJ) area — [lng, lat]; extra units so dispatch finds nearby BLS/ALS/ICU
  { unitId:'BLS-MUJ-01', type:'BLS', plate:'RJ14-CA-1101', crew:[{name:'Karan Singh',role:'EMT'},{name:'Lokesh Meena',role:'Driver'}],       coords:[75.5580,26.8480] },
  { unitId:'BLS-MUJ-02', type:'BLS', plate:'RJ14-CA-1102', crew:[{name:'Neha Sharma',role:'EMT'},{name:'Prakash Jat',role:'Driver'}],       coords:[75.5720,26.8390] },
  { unitId:'BLS-MUJ-03', type:'BLS', plate:'RJ14-CA-1103', crew:[{name:'Rohit Saini',role:'EMT'},{name:'Vikram Gurjar',role:'Driver'}],      coords:[75.5505,26.8365] },
  { unitId:'ALS-MUJ-01', type:'ALS', plate:'RJ14-CB-5101', crew:[{name:'Dr. Aditi Rao',role:'Paramedic'},{name:'Sohan Lal',role:'Driver'}], coords:[75.5600,26.8360] },
  { unitId:'ALS-MUJ-02', type:'ALS', plate:'RJ14-CB-5102', crew:[{name:'Dr. Imran Khan',role:'Paramedic'},{name:'Ravi Tomar',role:'Driver'}], coords:[75.5680,26.8500] },
  { unitId:'ALS-MUJ-03', type:'ALS', plate:'RJ14-CB-5103', crew:[{name:'Dr. Meera Iyer',role:'Paramedic'},{name:'Jagdish Prasad',role:'Driver'}], coords:[75.5770,26.8410] },
  { unitId:'ICU-MUJ-01', type:'ICU', plate:'RJ14-CC-6101', crew:[{name:'Dr. Nikhil B.',role:'Paramedic'},{name:'Nurse Suman R.',role:'Nurse'},{name:'Om Prakash',role:'Driver'}], coords:[75.5520,26.8420] },
  { unitId:'ICU-MUJ-02', type:'ICU', plate:'RJ14-CC-6102', crew:[{name:'Dr. Pallavi S.',role:'Paramedic'},{name:'Nurse Jyoti K.',role:'Nurse'},{name:'Ramesh Choudhary',role:'Driver'}], coords:[75.5750,26.8455] },
  { unitId:'ICU-MUJ-03', type:'ICU', plate:'RJ14-CC-6103', crew:[{name:'Dr. Tarun G.',role:'Paramedic'},{name:'Nurse Lata M.',role:'Nurse'},{name:'Shiv Charan',role:'Driver'}], coords:[75.5645,26.8310] },
];

const demoUser = {
  name: 'Amrisha',
  phone: '+91 98765 43210',
  phoneNormalized: '919876543210',
  passwordHash: bcrypt.hashSync('pran123', 10),
  email: 'amrisha@example.com',
  role: 'patient',
  savedLocations: [
    { label: 'Home', address: 'Manipal University Jaipur, Dehmi Kalan, RJ', coordinates: [75.5655, 26.8433] }
  ]
};

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  await Hospital.deleteMany({});
  await Ambulance.deleteMany({});
  await User.deleteMany({});
  console.log('Cleared existing data');

  const savedHospitals = await Hospital.insertMany(hospitals);
  console.log(`Seeded ${savedHospitals.length} hospitals`);

  const ambulances = ambulanceDefs.map((a, i) => ({
    unitId:       a.unitId,
    type:         a.type,
    licensePlate: a.plate,
    crew:         a.crew,
    hospital:     savedHospitals[i % savedHospitals.length]._id,
    status:       'available',
    location:     { type: 'Point', coordinates: a.coords },
    isActive:     true
  }));

  const savedAmbulances = await Ambulance.insertMany(ambulances);
  console.log(`Seeded ${savedAmbulances.length} ambulances`);

  await User.create(demoUser);
  console.log('Seeded demo user: Amrisha');

  console.log('\nSeed complete!');
  savedHospitals.forEach(h => console.log(`  Hospital: ${h.name} [${h.type}]`));
  savedAmbulances.forEach(a => console.log(`  Ambulance: ${a.unitId} [${a.type}] at ${a.location.coordinates}`));

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error('Seed error:', err); process.exit(1); });
