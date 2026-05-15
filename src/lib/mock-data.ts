export type BusinessType =
  | 'restaurant'
  | 'auto_repair'
  | 'salon'
  | 'clinic'
  | 'tutoring'
  | 'home_services'
  | 'other';

export type CallType = 'reservation' | 'order' | 'inquiry' | 'complaint';
export type CallStatus = 'resolved' | 'escalated' | 'missed';
export type RequestStatus = 'pending' | 'confirmed' | 'declined';

export interface Call {
  id: string;
  date: string;
  time: string;
  callerName: string;
  callerPhone: string;
  duration: string;
  type: CallType;
  status: CallStatus;
  summary: string;
}

export interface Reservation {
  id: string;
  requestedAt: string;
  guestName: string;
  phone: string;
  partySize: number;
  requestedDate: string;
  requestedTime: string;
  status: RequestStatus;
  notes: string;
  callId: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  requestedAt: string;
  customerName: string;
  phone: string;
  items: OrderItem[];
  total: number;
  status: RequestStatus;
  notes: string;
  callId: string;
}

export interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
}

export const MOCK_RESTAURANT = {
  businessType: 'restaurant' as BusinessType,
  name: 'Bella Notte Ristorante',
  phone: '(555) 867-5309',
  address: '123 Oak Street, Springfield, IL 62701',
  email: 'info@bellanotte.com',
  timezone: 'America/Chicago',
  aiVoice: 'Female – Warm',
  greetingMessage:
    'Thank you for calling {restaurant_name}! I\'m the AI assistant. How can I help you today?',
  callbackWindow: '2 hours',
  notifyEmail: true,
  notifySms: false,
};

export const MOCK_CALLS: Call[] = [
  {
    id: 'call-001',
    date: '2026-05-15',
    time: '12:34 PM',
    callerName: 'Sarah Mitchell',
    callerPhone: '(555) 234-5678',
    duration: '2:14',
    type: 'reservation',
    status: 'resolved',
    summary:
      'Caller requested a table for 4 on Friday May 17th at 7:30 PM. Party includes one high chair. Request logged as pending staff confirmation.',
  },
  {
    id: 'call-002',
    date: '2026-05-15',
    time: '11:58 AM',
    callerName: 'James Thornton',
    callerPhone: '(555) 876-5432',
    duration: '1:47',
    type: 'inquiry',
    status: 'resolved',
    summary:
      'Caller asked about gluten-free menu options and parking availability. AI provided information from the knowledge base.',
  },
  {
    id: 'call-003',
    date: '2026-05-15',
    time: '11:22 AM',
    callerName: 'Unknown',
    callerPhone: '(555) 000-1234',
    duration: '0:12',
    type: 'inquiry',
    status: 'missed',
    summary: 'Caller hung up before AI could respond.',
  },
  {
    id: 'call-004',
    date: '2026-05-15',
    time: '10:45 AM',
    callerName: 'Linda Park',
    callerPhone: '(555) 321-0987',
    duration: '3:02',
    type: 'order',
    status: 'resolved',
    summary:
      'Caller placed a takeout order for 2 margherita pizzas and 1 tiramisu. Order logged as pending staff confirmation.',
  },
  {
    id: 'call-005',
    date: '2026-05-15',
    time: '09:58 AM',
    callerName: 'Robert Chen',
    callerPhone: '(555) 654-3210',
    duration: '4:18',
    type: 'complaint',
    status: 'escalated',
    summary:
      'Caller complained about a previous order. Issue escalated to staff for follow-up.',
  },
  {
    id: 'call-006',
    date: '2026-05-14',
    time: '07:45 PM',
    callerName: 'Emma Davis',
    callerPhone: '(555) 789-0123',
    duration: '2:55',
    type: 'reservation',
    status: 'resolved',
    summary:
      'Caller requested a reservation for 2 on Saturday May 18th at 8:00 PM for an anniversary dinner. Special request: candles on table.',
  },
  {
    id: 'call-007',
    date: '2026-05-14',
    time: '06:30 PM',
    callerName: 'Michael Torres',
    callerPhone: '(555) 456-7890',
    duration: '1:33',
    type: 'inquiry',
    status: 'resolved',
    summary:
      'Caller asked about opening hours and whether the restaurant is open on Memorial Day.',
  },
  {
    id: 'call-008',
    date: '2026-05-14',
    time: '05:15 PM',
    callerName: 'Angela White',
    callerPhone: '(555) 123-4567',
    duration: '2:40',
    type: 'order',
    status: 'resolved',
    summary:
      'Caller placed a takeout order for 1 chicken parmesan and 1 Caesar salad.',
  },
];

export const MOCK_RESERVATIONS: Reservation[] = [
  {
    id: 'res-001',
    requestedAt: '2026-05-15 12:34 PM',
    guestName: 'Sarah Mitchell',
    phone: '(555) 234-5678',
    partySize: 4,
    requestedDate: 'May 17, 2026',
    requestedTime: '7:30 PM',
    status: 'pending',
    notes: 'Party includes one high chair.',
    callId: 'call-001',
  },
  {
    id: 'res-002',
    requestedAt: '2026-05-14 07:45 PM',
    guestName: 'Emma Davis',
    phone: '(555) 789-0123',
    partySize: 2,
    requestedDate: 'May 18, 2026',
    requestedTime: '8:00 PM',
    status: 'pending',
    notes: 'Anniversary dinner. Candles requested.',
    callId: 'call-006',
  },
  {
    id: 'res-003',
    requestedAt: '2026-05-13 03:22 PM',
    guestName: 'David Kim',
    phone: '(555) 987-6543',
    partySize: 6,
    requestedDate: 'May 16, 2026',
    requestedTime: '6:00 PM',
    status: 'confirmed',
    notes: 'Birthday party. Cake being brought by guests.',
    callId: 'call-009',
  },
  {
    id: 'res-004',
    requestedAt: '2026-05-13 11:10 AM',
    guestName: 'Patricia Moore',
    phone: '(555) 246-8135',
    partySize: 3,
    requestedDate: 'May 15, 2026',
    requestedTime: '7:00 PM',
    status: 'confirmed',
    notes: 'One guest has a nut allergy.',
    callId: 'call-010',
  },
  {
    id: 'res-005',
    requestedAt: '2026-05-12 04:55 PM',
    guestName: 'Tom Bradley',
    phone: '(555) 135-2468',
    partySize: 2,
    requestedDate: 'May 14, 2026',
    requestedTime: '8:30 PM',
    status: 'declined',
    notes: 'Requested date fully booked.',
    callId: 'call-011',
  },
];

export const MOCK_ORDERS: Order[] = [
  {
    id: 'ord-001',
    requestedAt: '2026-05-15 10:45 AM',
    customerName: 'Linda Park',
    phone: '(555) 321-0987',
    items: [
      { name: 'Margherita Pizza', quantity: 2, price: 16.99 },
      { name: 'Tiramisu', quantity: 1, price: 8.99 },
    ],
    total: 42.97,
    status: 'pending',
    notes: 'Extra basil on the pizzas.',
    callId: 'call-004',
  },
  {
    id: 'ord-002',
    requestedAt: '2026-05-14 05:15 PM',
    customerName: 'Angela White',
    phone: '(555) 123-4567',
    items: [
      { name: 'Chicken Parmesan', quantity: 1, price: 22.99 },
      { name: 'Caesar Salad', quantity: 1, price: 12.99 },
    ],
    total: 35.98,
    status: 'confirmed',
    notes: '',
    callId: 'call-008',
  },
  {
    id: 'ord-003',
    requestedAt: '2026-05-14 01:30 PM',
    customerName: 'Kevin Jones',
    phone: '(555) 864-2097',
    items: [
      { name: 'Spaghetti Carbonara', quantity: 2, price: 18.99 },
      { name: 'Garlic Bread', quantity: 2, price: 4.99 },
      { name: 'House Red Wine (bottle)', quantity: 1, price: 32.0 },
    ],
    total: 79.96,
    status: 'confirmed',
    notes: 'No onions in the carbonara.',
    callId: 'call-012',
  },
  {
    id: 'ord-004',
    requestedAt: '2026-05-13 07:10 PM',
    customerName: 'Maria Gonzalez',
    phone: '(555) 753-9514',
    items: [
      { name: 'Vegetarian Lasagna', quantity: 1, price: 19.99 },
      { name: 'Minestrone Soup', quantity: 1, price: 9.99 },
    ],
    total: 29.98,
    status: 'declined',
    notes: 'Delivery address outside service area.',
    callId: 'call-013',
  },
];

export const MOCK_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'kb-001',
    category: 'Hours',
    question: 'What are your hours?',
    answer:
      'We are open Tuesday through Sunday. Lunch: 11:30 AM – 2:30 PM. Dinner: 5:00 PM – 10:00 PM. We are closed on Mondays.',
  },
  {
    id: 'kb-002',
    category: 'Hours',
    question: 'Are you open on holidays?',
    answer:
      'We are open on most major holidays but may have reduced hours. Please call ahead to confirm on Thanksgiving and Christmas Day.',
  },
  {
    id: 'kb-003',
    category: 'Reservations',
    question: 'How do I make a reservation?',
    answer:
      'You can call us and our AI assistant will log your request. All reservations are subject to availability and require staff confirmation. You will receive a callback within 2 hours during business hours.',
  },
  {
    id: 'kb-004',
    category: 'Reservations',
    question: 'What is your cancellation policy?',
    answer:
      'We ask that you notify us at least 24 hours in advance if you need to cancel. For parties of 6 or more, 48 hours notice is required.',
  },
  {
    id: 'kb-005',
    category: 'Menu',
    question: 'Do you have gluten-free options?',
    answer:
      'Yes! We offer gluten-free pasta and pizza bases. Please inform your server of any allergies when you arrive. Note that our kitchen is not a certified gluten-free facility.',
  },
  {
    id: 'kb-006',
    category: 'Menu',
    question: 'Do you have vegetarian or vegan options?',
    answer:
      'We have several vegetarian options including our popular Vegetarian Lasagna and Margherita Pizza. For vegan guests, please ask your server about current vegan-adaptable dishes.',
  },
  {
    id: 'kb-007',
    category: 'Parking',
    question: 'Is there parking available?',
    answer:
      'There is free street parking on Oak Street and a public parking garage one block away on Maple Ave. The garage charges $3/hour.',
  },
  {
    id: 'kb-008',
    category: 'Orders',
    question: 'Do you offer takeout or delivery?',
    answer:
      'We offer takeout orders. Please call or use our online ordering system. Delivery is available within a 3-mile radius via DoorDash and Uber Eats.',
  },
];

export const SIMULATOR_SCRIPT = [
  {
    role: 'ai' as const,
    text: "Thank you for calling Bella Notte Ristorante! I'm the AI assistant. How can I help you today?",
  },
  { role: 'caller' as const, text: "Hi, I'd like to make a reservation for this Saturday." },
  {
    role: 'ai' as const,
    text: "Wonderful! I'd be happy to help with that. May I have your name, please?",
  },
  { role: 'caller' as const, text: "Sure, it's John Walker." },
  { role: 'ai' as const, text: 'Thank you, John. How many people will be in your party?' },
  { role: 'caller' as const, text: "There'll be 4 of us." },
  { role: 'ai' as const, text: 'Great — a party of 4. What time were you thinking for Saturday?' },
  { role: 'caller' as const, text: 'Around 7 PM if possible.' },
  {
    role: 'ai' as const,
    text: "I've logged your request for Saturday, May 17th at 7:00 PM for 4 guests. Please note this is pending confirmation from our staff — you'll receive a callback within 2 hours to confirm. Do you have any special requests?",
  },
  { role: 'caller' as const, text: "No, that's all. Thanks!" },
  {
    role: 'ai' as const,
    text: "Perfect! I've noted your reservation request for John Walker, party of 4, Saturday May 17th at 7 PM. Our team will confirm shortly. Have a wonderful day!",
  },
];
