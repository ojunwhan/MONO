// MONO Hospital Mode — Patient-Side Sentences (Reverse Direction)
// For translation cache seeding: {foreign_lang} → ko direction
//
// These are sentences PATIENTS commonly say.
// English is the source — the seed script will:
// 1. Translate each English sentence → 49 other languages (to get what patients say in their language)
// 2. Also translate each → Korean (to get the ko target)
// 3. Store as {lang}:ko:hospital_plastic_surgery:{sentence_in_that_lang} → Korean translation
//
// Additionally, the English originals are stored as en:ko:hospital_plastic_surgery:{english} → Korean

const PATIENT_SENTENCES_EN = [

  // ================================================================
  // 1. 기본 인사/소통 (Basic Communication)
  // ================================================================
  'Hello.',
  'Thank you.',
  'Yes.',
  'No.',
  'I understand.',
  'I don\'t understand.',
  'Please speak slowly.',
  'Can you say that again?',
  'Where is the bathroom?',
  'I need help.',
  'Excuse me.',
  'I\'m sorry.',

  // ================================================================
  // 2. 상담 관련 (Consultation Questions)
  // ================================================================
  'How much does it cost?',
  'Is there a discount?',
  'Can I pay in installments?',
  'Do you accept credit cards?',
  'Can I get a tax refund?',
  'Does it hurt?',
  'How painful is it?',
  'Will there be a scar?',
  'How long is the recovery?',
  'How long does the surgery take?',
  'When can I go back to work?',
  'When can I fly home?',
  'Can I fly home in 3 days?',
  'Can I fly home in a week?',
  'How long do I need to stay in Korea?',
  'What are the side effects?',
  'What are the risks?',
  'Is it safe?',
  'How long do the results last?',
  'Is the result permanent?',
  'Will it look natural?',
  'Can you show me before and after photos?',
  'Can I see the doctor\'s portfolio?',
  'I want to look natural, not overdone.',
  'I want a noticeable change.',
  'I\'m not sure yet. Can I think about it?',
  'Can I come back tomorrow to decide?',
  'I want to get a second opinion.',
  'My friend recommended this clinic.',
  'I saw this clinic on social media.',
  'I saw your reviews online.',

  // ================================================================
  // 3. 시술 요청 (Procedure Requests)
  // ================================================================
  'I want double eyelid surgery.',
  'I\'m interested in a nose job.',
  'I want to fix my nose.',
  'I want to make my nose higher.',
  'I want to make my nose smaller.',
  'I want a V-line jaw surgery.',
  'I want cheekbone reduction.',
  'I want liposuction.',
  'I want fat grafting to my face.',
  'I want lip filler.',
  'I want Botox.',
  'I want Botox for my jaw.',
  'I want Botox for my forehead.',
  'I want under-eye filler.',
  'I want to remove my dark circles.',
  'I want to get rid of wrinkles.',
  'I want a facelift.',
  'I want a thread lift.',
  'I want breast augmentation.',
  'I want breast reduction.',
  'I want to fix my ears.',
  'I want ear surgery.',
  'I want hair transplant.',
  'I want to fix my hairline.',
  'I want to remove this mole.',
  'I want to remove this scar.',
  'I want skin whitening treatment.',
  'I want laser treatment.',
  'I want to treat my acne scars.',
  'I want to reduce my pores.',
  'I\'m interested in Ultherapy.',
  'I\'m interested in Thermage.',
  'I want a skin booster treatment.',
  'I want teeth whitening.',
  'I want teeth veneers.',

  // ================================================================
  // 4. 건강/병력 관련 (Health & Medical History)
  // ================================================================
  'I have no allergies.',
  'I\'m allergic to penicillin.',
  'I\'m allergic to certain medications.',
  'I have high blood pressure.',
  'I have diabetes.',
  'I have a heart condition.',
  'I take blood thinners.',
  'I\'m currently taking medication.',
  'Here is my medical record.',
  'I had surgery before.',
  'I had nose surgery before.',
  'I had eye surgery before.',
  'I had filler before.',
  'I had Botox before.',
  'I have never had surgery.',
  'I have never had anesthesia.',
  'I don\'t smoke.',
  'I smoke occasionally.',
  'I don\'t drink alcohol.',
  'I\'m pregnant.',
  'I might be pregnant.',
  'I\'m breastfeeding.',
  'I bruise easily.',
  'I have keloid scarring.',

  // ================================================================
  // 5. 통증/상태 표현 (Pain & Condition)
  // ================================================================
  'It hurts here.',
  'It\'s very painful.',
  'The pain is getting worse.',
  'It doesn\'t hurt much.',
  'I feel dizzy.',
  'I feel nauseous.',
  'I feel like I\'m going to vomit.',
  'I have a headache.',
  'I feel swollen.',
  'It\'s very swollen.',
  'The swelling is getting worse.',
  'I see bruising.',
  'The bruise is getting bigger.',
  'I have a fever.',
  'I feel cold.',
  'I feel numbness.',
  'I can\'t feel this area.',
  'It\'s itchy.',
  'It\'s bleeding a little.',
  'There is discharge from the wound.',
  'I can\'t sleep because of the pain.',
  'The pain medicine is not working.',
  'I need stronger pain medicine.',
  'I feel fine.',
  'I feel much better.',
  'I feel the same as yesterday.',

  // ================================================================
  // 6. 수술 전후 질문 (Pre/Post-op Questions)
  // ================================================================
  'What time is my surgery?',
  'Can I eat before surgery?',
  'Can I drink water?',
  'What should I wear?',
  'Should I remove my contact lenses?',
  'Should I remove my makeup?',
  'Do I need someone with me?',
  'Can my friend come in with me?',
  'How long will I be asleep?',
  'When can I wash my face?',
  'When can I take a shower?',
  'When can I wear makeup?',
  'When should I come back?',
  'When do the stitches come out?',
  'Can I exercise?',
  'Can I go swimming?',
  'Can I drink alcohol?',
  'Can I smoke?',
  'What foods should I avoid?',
  'Can I sleep on my side?',
  'How should I sleep?',
  'Is this normal?',
  'Is this amount of swelling normal?',
  'Is this amount of bruising normal?',
  'Should I be worried?',
  'When will the swelling go down?',
  'When will the bruises disappear?',
  'When will I see the final result?',

  // ================================================================
  // 7. 행정/숙소 (Admin & Accommodation)
  // ================================================================
  'I need a receipt.',
  'I need a medical certificate.',
  'Can you send the documents to my email?',
  'I need a doctor\'s note for my insurance.',
  'Can you call a taxi for me?',
  'Where is the nearest pharmacy?',
  'Where is the nearest convenience store?',
  'Can you recommend a hotel nearby?',
  'Do you have airport pickup?',
  'What time should I arrive tomorrow?',
  'I\'m staying at this hotel.',
  'My flight is on this date.',
  'I\'m leaving Korea in 3 days.',
  'I\'m leaving Korea in a week.',
  'I\'m leaving Korea in 2 weeks.',
  'Can I get my medication at the airport pharmacy?',
  'My companion doesn\'t speak Korean either.',

  // ================================================================
  // 8. 불만/요청 (Complaints & Requests)
  // ================================================================
  'I\'m not happy with the result.',
  'It looks different from what I expected.',
  'It\'s not symmetrical.',
  'Can this be fixed?',
  'I want a revision surgery.',
  'I want a refund.',
  'I want to speak to the doctor.',
  'I want to speak to the manager.',
  'I need more time to think.',
  'I changed my mind.',
  'I don\'t want to do it anymore.',
  'Can I cancel the surgery?',
  'Can I reschedule?',

  // ================================================================
  // 9. 감사/인사 (Gratitude & Farewell)
  // ================================================================
  'Thank you, doctor.',
  'Thank you for explaining everything.',
  'I\'m very satisfied with the result.',
  'I will recommend this clinic to my friends.',
  'I\'ll come back for a follow-up.',
  'See you next time.',
  'Goodbye.',
  'Take care.',
];

module.exports = PATIENT_SENTENCES_EN;
