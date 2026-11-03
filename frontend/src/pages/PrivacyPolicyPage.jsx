import React from 'react';
import LegalPageLayout, { LegalTldr, LegalIntro, LegalSection, LegalEmail } from '../components/LegalPageLayout.jsx';

// Content mirrors docs/legal/privacy-policy.md (the written record). If either
// changes, update both — and ADR-013 — per the standing obligation in that ADR.

function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated="2 November 2026"
      canonicalPath="/privacy"
      metaTitle="Privacy Policy — Zuno AI Tutor"
    >
      <LegalTldr>
        Hum sirf tumhara <b>naam aur email</b> lete hain, aur tumhare study sawaal-jawaab
        save karte hain taaki Zuno tumhari padhai me madad kar sake. Hum tumhara data{' '}
        <b>bechte nahi</b> aur ads ke liye use nahi karte. Jab chaaho, email karke apna
        data <b>delete</b> karwa sakte ho. Agar tum 18 se kam ho, ye page apne parent ya
        guardian ke saath padho.
      </LegalTldr>

      <LegalIntro>
        This Privacy Policy explains what information Zuno collects, why, and what choices
        you have. Zuno is an AI study tutor for Bihar Board Class 10 Science students.
      </LegalIntro>

      <LegalSection n="1" title="What we collect">
        <ul>
          <li><b>If you create an account:</b> your name and email address.</li>
          <li><b>Your study chats:</b> the questions you ask and Zuno's answers, so you can see your history and track your progress.</li>
          <li><b>If you use Zuno as a guest</b> (without an account): only your questions and a random guest id — no name or email.</li>
        </ul>
        <p>We do <b>not</b> ask for your phone number, gender, photo, home address, or any payment details.</p>
      </LegalSection>

      <LegalSection n="2" title="Why we collect it">
        <ul>
          <li><b>Name and email</b> — to create your account, let you log in, and send account emails (like email verification and password reset).</li>
          <li><b>Study chats</b> — to answer your questions, show your chat history, and track which topics you have studied.</li>
        </ul>
        <p>We do <b>not</b> use your information for advertising.</p>
      </LegalSection>

      <LegalSection n="3" title="Who we share it with">
        <p>To run Zuno, we use a few trusted services. Your information passes through them only to make Zuno work:</p>
        <ul>
          <li><b>OpenAI</b> — your questions are sent here to generate answers.</li>
          <li><b>Google</b> — if you log in with Google, and as a backup that helps process questions when our main provider is down.</li>
          <li><b>MongoDB Atlas</b> — stores your account and chat data.</li>
          <li><b>Our email service</b> — sends account emails (verification, password reset).</li>
          <li><b>Hosting and caching services (Render, Vercel, Upstash)</b> — run the app.</li>
        </ul>
        <p>We do <b>not</b> sell your information to anyone, and we do <b>not</b> share it for advertising.</p>
      </LegalSection>

      <LegalSection n="4" title="How long we keep it">
        <ul>
          <li>While your account is active, we keep your data.</li>
          <li>If your account is unused for <b>more than 6 months</b>, we may delete your data at any time after that. This is done by hand, so it may take days or months.</li>
          <li>Guest data is minimal (just questions and a random id) and is not linked to your name or email.</li>
        </ul>
      </LegalSection>

      <LegalSection n="5" title="Your choices">
        <ul>
          <li>You can ask us to <b>delete</b> your account and data.</li>
          <li>You can ask to <b>see or correct</b> the information we hold about you.</li>
        </ul>
        <p>To do any of these, email us at <LegalEmail />. We do this by hand, so please allow a little time.</p>
      </LegalSection>

      <LegalSection n="6" title="Children and minors" highlight>
        <p>
          Zuno is made for Class 10 students, who are often under 18. If you are under 18,
          please use Zuno only with the knowledge and agreement of a parent or guardian. We
          collect as little information as possible, and we <b>never</b> track children for
          advertising. A parent or guardian can email us at <LegalEmail /> to see or delete
          their child's data.
        </p>
      </LegalSection>

      <LegalSection n="7" title="How we protect your data">
        <p>Passwords are stored in a scrambled (hashed) form, never as plain text. Data travels over a secure (HTTPS) connection. No system is perfectly safe, but we take reasonable care.</p>
      </LegalSection>

      <LegalSection n="8" title="Cookies and local storage">
        <p>Zuno uses your browser's local storage only to keep you signed in and remember your session. We do <b>not</b> use advertising or third-party tracking cookies.</p>
      </LegalSection>

      <LegalSection n="9" title="Changes to this policy">
        <p>We may update this policy from time to time. The "last updated" date at the top will change, and big changes will be shown in the app.</p>
      </LegalSection>

      <LegalSection n="10" title="Contact">
        <p>Questions about your privacy, or want your data deleted? Email us at <LegalEmail />.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}

export default PrivacyPolicyPage;
