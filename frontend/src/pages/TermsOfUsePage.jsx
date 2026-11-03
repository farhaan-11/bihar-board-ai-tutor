import React from 'react';
import LegalPageLayout, { LegalTldr, LegalIntro, LegalSection, LegalEmail } from '../components/LegalPageLayout.jsx';

// Content mirrors docs/legal/terms-of-use.md (the written record). If either
// changes, update both — and ADR-013 — per the standing obligation in that ADR.

function TermsOfUsePage() {
  return (
    <LegalPageLayout
      title="Terms of Use"
      lastUpdated="2 November 2026"
      canonicalPath="/terms"
      metaTitle="Terms of Use — Zuno AI Tutor"
    >
      <LegalTldr>
        Zuno padhai me madad ke liye hai, <b>teacher ki jagah nahi</b>. AI kabhi-kabhi
        galat ho sakta hai, to zaroori cheezein apni book ya teacher se zaroor cross-check
        karo. Agar tum 18 se kam ho, to <b>parent/guardian ki ijaazat</b> se hi use karo.
        Galat use karoge to hum account band kar sakte hain.
      </LegalTldr>

      <LegalIntro>
        By using Zuno, you agree to these Terms. Zuno is an AI study tutor for Bihar Board
        Class 10 Science.
      </LegalIntro>

      <LegalSection n="1" title="Who can use Zuno" highlight>
        <p>
          By using Zuno, you confirm that you are <b>18 or older</b>, <b>or</b> that a parent
          or guardian has read these Terms and our Privacy Policy and agrees on your behalf.
          If you are a student under 18, please use Zuno with your parent's or guardian's
          knowledge.
        </p>
      </LegalSection>

      <LegalSection n="2" title="What Zuno is (and is not)">
        <p>Zuno helps you understand Class 10 Science by answering your questions from study material. It is a <b>study aid, not a replacement</b> for your teacher, textbook, or school.</p>
        <p>Zuno uses AI, and AI can sometimes be wrong or incomplete. Always check important answers against your textbook or teacher. Zuno only tries to answer from its study content — if it does not have the content, it will tell you instead of guessing.</p>
      </LegalSection>

      <LegalSection n="3" title="Using Zuno properly">
        <p>Please use Zuno for studying. Do not misuse it — for example, do not try to break it, abuse it, send harmful or offensive content, or use it for anything other than learning.</p>
      </LegalSection>

      <LegalSection n="4" title="Your account">
        <p>Keep your login details safe. You are responsible for what happens under your account. Tell us if you think someone else is using it.</p>
      </LegalSection>

      <LegalSection n="5" title="Our rights">
        <p>We may limit, pause, or close an account that misuses Zuno or breaks these Terms. We may also change or stop features as the product grows.</p>
      </LegalSection>

      <LegalSection n="6" title="No guarantee">
        <p>Zuno is provided "as is". We try hard to keep it correct and available, but we cannot promise it will always be right, always work, or never go down. To the extent allowed by law, we are not responsible for losses that come from relying on an answer. (Remember: check important answers with your teacher or textbook.)</p>
      </LegalSection>

      <LegalSection n="7" title="Changes to these Terms">
        <p>We may update these Terms from time to time. The "last updated" date will change, and big changes will be shown in the app. Using Zuno after a change means you accept the new Terms.</p>
      </LegalSection>

      <LegalSection n="8" title="Governing law">
        <p>These Terms follow the laws of India.</p>
      </LegalSection>

      <LegalSection n="9" title="Contact">
        <p>Questions about these Terms? Email us at <LegalEmail />.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}

export default TermsOfUsePage;
