export const fieldKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function buildAnswers(profile, qa = []) {
  const parts = String(profile.name || "")
      .trim()
      .split(/\s+/),
    answers = {};
  const add = (names, value) => {
    if (value)
      for (const name of names) answers[fieldKey(name)] = String(value);
  };
  add(["name", "full name", "your name"], profile.name);
  add(["first name", "given name"], parts[0]);
  add(["last name", "surname", "family name"], parts.slice(1).join(" "));
  add(["email", "email address"], profile.email);
  add(["phone", "phone number", "mobile"], profile.phone);
  add(["location", "city", "current location"], profile.location);
  add(["linkedin", "linkedin profile", "linkedin url"], profile.linkedin);
  add(["github", "github url"], profile.github);
  add(["portfolio", "website", "personal website"], profile.portfolio);
  add(["notice period"], profile.noticePeriod);
  add(["expected salary", "expected ctc"], profile.expectedSalary);
  for (const item of qa)
    if (item.question && item.answer)
      answers[fieldKey(item.question)] = String(item.answer);
  return answers;
}
export function fillApplication(answers, resume) {
  // This function is serialized by chrome.scripting. Keep it self-contained.
  const key = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const challenge = document.querySelector(
    'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],input[name="cf-turnstile-response"],.h-captcha,.g-recaptcha',
  );
  if (challenge)
    return {
      status: "blocked",
      missing: ["A verification challenge requires your direct interaction."],
    };
  let filled = 0;
  const missing = [];
  for (const input of document.querySelectorAll("input,textarea,select")) {
    if (
      input.disabled ||
      input.readOnly ||
      ["hidden", "submit", "button", "password", "checkbox", "radio"].includes(
        input.type,
      )
    )
      continue;
    const label =
      input.labels?.[0]?.textContent ||
      input.getAttribute("aria-label") ||
      input.placeholder ||
      input.name ||
      input.id;
    if (input.type === "file") {
      if (resume && /resume|résumé|cv/i.test(label + " " + input.name)) {
        try {
          const bytes = Uint8Array.from(atob(resume.base64), (c) =>
              c.charCodeAt(0),
            ),
            data = new DataTransfer();
          data.items.add(
            new File([bytes], resume.name, {
              type: resume.name.endsWith(".pdf")
                ? "application/pdf"
                : "application/octet-stream",
            }),
          );
          input.files = data.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          filled++;
        } catch {
          missing.push("Attach your résumé manually.");
        }
      }
      continue;
    }
    if (input.value) continue;
    const value =
      answers[key(label)] || answers[key(input.name)] || answers[key(input.id)];
    if (value) {
      if (input.tagName === "SELECT") {
        const option = [...input.options].find(
          (o) => key(o.text) === key(value) || key(o.value) === key(value),
        );
        if (option) {
          input.value = option.value;
          filled++;
        } else missing.push(label);
      } else {
        const setter = Object.getOwnPropertyDescriptor(
          input.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        filled++;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (input.required) missing.push(label || "Unmapped required field");
  }
  if (!filled)
    missing.push(
      "Open the application form manually; custom or multi-step controls may need your input.",
    );
  return {
    status: "needs-review",
    filled,
    missing: [...new Set(missing)],
    note: "Review every field and submit yourself. No submission button was clicked.",
  };
}
