import type { VerticalProfile } from '../core/types';

export const tutoringProfile: VerticalProfile = {
  id: 'tutoring',
  label: 'Tutoring / Education',
  description: 'A tutoring or education center booking lessons and answering enrollment questions.',
  commonIntents: [
    'tutoring inquiry', 'subject help', 'grade/level', 'scheduling',
    'pricing', 'trial lesson',
  ],
  terminology: 'Talk about subjects, students, grade levels, sessions, and tutors. A "booking" means a lesson or trial.',
  knowledgeCategories: ['Subjects', 'Grade Levels', 'Scheduling', 'Pricing Policy', 'Trial Class', 'Online/In-Person', 'Staff'],
  interpretationExamples: [
    '"math help", "English class", "exam prep", "SAT", "reading" = a tutoring inquiry/booking with that subject',
    'A grade or age ("my son is in 7th grade") = the student level',
  ],
  collectionPriorities: 'Collect the subject, student level/grade, preferred schedule, name, and phone.',
  forbiddenAssumptions: [
    'Do not invent pricing, tutor availability, or guaranteed outcomes',
    'Do not assume in-person vs online unless stated in the knowledge base',
  ],
  fallbackWording: 'For pricing, tutor matching, or scheduling specifics not in the knowledge base, say the team will follow up.',
  suggestedRequestTypes: ['Tutoring inquiries', 'Trial lessons', 'Subject help', 'Scheduling', 'Pricing inquiries', 'Online vs in-person'],
  suggestedDetailFields: ['Caller name', 'Phone number', 'Student name', 'Grade / level', 'Subject', 'Preferred schedule', 'Notes'],
};
