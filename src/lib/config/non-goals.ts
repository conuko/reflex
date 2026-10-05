// Things the product deliberately won't build. Each one becomes a yes/no
// question in the question set, so a feature request that asks for one can be
// answered "Won't do". Changing this text changes the question set: bump
// QUESTION_SET_VERSION in src/lib/triage/questions.ts.

export type NonGoal = {
  /** Stable id; the question id is `nongoal_<id>`. */
  id: string;
  what: string;
  not_for: string;
  examples: readonly string[];
};

export const NON_GOALS: readonly NonGoal[] = [
  {
    id: "self_hosting",
    what: "Running the platform on the customer's own servers or private cloud: an on-premises, self-hosted, offline or air-gapped edition.",
    not_for:
      "Choosing the hosting region of the cloud service, or connecting a model the customer hosts themselves through the API.",
    examples: [
      "Can we install the platform in our own data center?",
      "We need a Docker image to run everything inside our VPC.",
    ],
  },
  {
    id: "native_mobile_apps",
    what: "Native iOS or Android apps for the platform, installed from an app store.",
    not_for: "Problems using the web app in a mobile browser.",
    examples: [
      "Please ship an iPhone app so our field team can chat with agents.",
      "Is an Android app on the roadmap?",
    ],
  },
  {
    id: "media_generation",
    what: "Generating images, video, music or voice clones as the output of chats, agents or workflows.",
    not_for:
      "Reading or describing uploaded images and documents, or rendering charts and tables from data.",
    examples: [
      "Add text-to-image so agents can create marketing visuals.",
      "Can workflows produce a short video from a script?",
    ],
  },
];
