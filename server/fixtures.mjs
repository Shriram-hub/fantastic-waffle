import { id, now } from "./domain.mjs";

export function initialState(demo = true) {
  const profile = demo
    ? {
        name: "Alex Morgan",
        email: "alex@candidate.example",
        headline: "Software engineer, curious by default",
        phone: "",
        location: "Bengaluru",
        portfolio: "",
        authorization: "",
        summary:
          "I enjoy turning complex problems into thoughtful, useful products.",
        skills: ["JavaScript", "React", "TypeScript", "Node.js", "SQL"],
        interests: ["Software engineer", "Frontend engineer"],
        workMode: "Remote",
      }
    : {
        name: "",
        email: "",
        phone: "",
        headline: "",
        location: "",
        portfolio: "",
        authorization: "",
        summary: "",
        skills: [],
        interests: [],
        workMode: "Any",
      };
  const listings = [
    [
      "Forma",
      "Frontend Engineer",
      "Bengaluru, India",
      "Remote",
      "₹18L – ₹28L",
      ["React", "TypeScript", "JavaScript"],
      "Engineering",
    ],
    [
      "Layer",
      "Full Stack Engineer",
      "Remote, worldwide",
      "Remote",
      "$80k – $120k",
      ["React", "Node.js", "SQL", "TypeScript", "JavaScript"],
      "Engineering",
    ],
    [
      "Northstar",
      "Software Engineer, Platform",
      "Bengaluru, India",
      "Hybrid",
      "₹24L – ₹36L",
      ["Node.js", "SQL", "TypeScript", "Docker"],
      "Engineering",
    ],
    [
      "Quarry",
      "Product Designer",
      "Mumbai, India",
      "Hybrid",
      "₹14L – ₹24L",
      ["Figma", "Research", "Design systems"],
      "Design",
    ],
    [
      "Pulsepay",
      "React Developer",
      "Remote, India",
      "Remote",
      "₹16L – ₹26L",
      ["React", "JavaScript", "TypeScript", "SQL"],
      "Engineering",
    ],
    [
      "Clover",
      "Data Analyst",
      "Pune, India",
      "Hybrid",
      "₹10L – ₹18L",
      ["SQL", "Python", "Tableau"],
      "Data & analytics",
    ],
    [
      "Waypoint",
      "Growth Marketing Manager",
      "Remote, India",
      "Remote",
      "₹16L – ₹25L",
      ["SEO", "Analytics", "Content"],
      "Marketing",
    ],
    [
      "Pencil",
      "Associate Product Manager",
      "Bengaluru, India",
      "On-site",
      "₹12L – ₹20L",
      ["Research", "Analytics", "SQL"],
      "Product",
    ],
    [
      "Meridian",
      "Machine Learning Engineer",
      "Hyderabad, India",
      "Hybrid",
      "₹22L – ₹38L",
      ["Python", "PyTorch", "SQL"],
      "Data & analytics",
    ],
    [
      "Pebble",
      "Customer Success Associate",
      "Remote, India",
      "Remote",
      "₹8L – ₹14L",
      ["Communication", "CRM", "Support"],
      "Customer success",
    ],
    [
      "Arc",
      "Backend Software Engineer",
      "Remote, worldwide",
      "Remote",
      "$90k – $140k",
      ["Node.js", "JavaScript", "SQL", "TypeScript"],
      "Engineering",
    ],
    [
      "Goodwork",
      "Biomedical Research Analyst",
      "Delhi, India",
      "On-site",
      "₹10L – ₹18L",
      ["Research", "Clinical analysis", "Documentation"],
      "Biomedical",
    ],
  ];
  const jobs = demo
    ? listings.map((j, i) => ({
        id: `sample-${i + 1}`,
        company: j[0],
        title: j[1],
        location: j[2],
        workMode: j[3],
        salary: j[4],
        tags: j[5],
        category: j[6],
        type: "Full-time",
        source: "Sample",
        isDemo: true,
        url: "",
        publishedAt: new Date(Date.now() - i * 11 * 3600_000).toISOString(),
        description: `This fictional ${j[1]} role at ${j[0]} demonstrates the Veloce workflow. Collaborate with a thoughtful team, take ownership of meaningful work, and develop your craft. Relevant skills include ${j[5].join(", ")}. Sample compensation is illustrative. This is not a live vacancy.`,
      }))
    : [];
  const contacts = demo
    ? [
        ["Jamie Chen", "jamie@forma.example", "Forma", "Talent Partner"],
        ["Priya Shah", "priya@layer.example", "Engineering Lead"],
        ["Sam Rivera", "sam@northstar.example", "Hiring Manager"],
        ["Jordan Lee", "jordan@pulsepay.example", "Technical Recruiter"],
        ["Taylor Kim", "taylor@arc.example", "Head of People"],
      ].map(([name, email, company, title]) => ({
        id: id(),
        name,
        email,
        company,
        title,
        emailStatus: "unverified",
        source: "Sample",
        isDemo: true,
        suppressed: false,
        createdAt: now(),
      }))
    : [];
  const applications = demo
    ? jobs.slice(0, 6).map((j, i) => ({
        id: id(),
        jobId: j.id,
        stage: ["Saved", "Applied", "Interview", "Saved", "Ready", "Applied"][
          i
        ],
        notes: "",
        createdAt: now(),
        updatedAt: now(),
        isDemo: true,
        history: [
          {
            stage: [
              "Saved",
              "Applied",
              "Interview",
              "Saved",
              "Ready",
              "Applied",
            ][i],
            at: now(),
            source: "Sample",
          },
        ],
      }))
    : [];
  return {
    version: 1,
    isDemo: demo,
    profile,
    resume: null,
    jobs,
    contacts,
    applications,
    campaigns: [],
    inbox: [],
    previews: {},
    settings: { greenhouseBoards: [], leverBoards: [] },
    syncs: {},
  };
}
