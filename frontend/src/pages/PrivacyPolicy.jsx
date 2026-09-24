import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12 text-mv-text font-sans">
      <h1 className="text-3xl font-display font-bold mb-6">Privacy Policy</h1>
      <p className="mb-4 text-mv-muted">Last updated: {new Date().toLocaleDateString()}</p>
      
      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>
          <p className="text-mv-muted leading-relaxed">
            We collect information necessary to provide and improve our services, including:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Personal Information:</strong> Name, phone number, email address, and driver's license details for account creation and identity verification.</li>
              <li><strong>Location Data:</strong> We collect precise and approximate location data to track fleet vehicles, calculate trip distances, and ensure safety. This may be collected in the background while using the driver application.</li>
              <li><strong>Usage Data:</strong> Information about how you interact with the app, including app crashes and performance metrics.</li>
            </ul>
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. How We Use Your Information</h2>
          <p className="text-mv-muted leading-relaxed">
            We use the collected information for the following purposes:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>To provide, operate, and maintain our fleet management and rental services.</li>
              <li>To verify your identity and ensure compliance with our rental terms.</li>
              <li>To track vehicle usage and calculate accurate billing (e.g., odometer logs).</li>
              <li>To communicate with you regarding your account, rentals, and payments.</li>
            </ul>
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Data Sharing and Disclosure</h2>
          <p className="text-mv-muted leading-relaxed">
            We do not sell your personal data. We may share your information with trusted third-party service providers who assist us in operating our application, conducting our business, or serving our users (e.g., payment processors like Razorpay), so long as those parties agree to keep this information confidential.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Data Security</h2>
          <p className="text-mv-muted leading-relaxed">
            We implement industry-standard security measures to protect your personal information in transit and at rest. However, no method of transmission over the Internet or electronic storage is 100% secure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Your Rights & Data Deletion</h2>
          <p className="text-mv-muted leading-relaxed">
            You have the right to access, update, or delete your personal information. You may request account deletion directly through the application settings or by contacting our support team. Upon deletion, we will remove your personal data, except where retention is required by law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Contact Us</h2>
          <p className="text-mv-muted leading-relaxed">
            If you have any questions about this Privacy Policy, please contact us at support@route39.in.
          </p>
        </section>
      </div>
    </div>
  );
}
