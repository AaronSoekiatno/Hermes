// Candidate - represents a user who uploaded their resume
N::Candidate {
    name: String,
    email: String,
    summary: String,
    skills: String,
    embedding: V<768>,
}

// Startup - represents a startup from the dataset
N::Startup {
    name: String,
    industry: String,
    description: String,
    funding_stage: String,
    funding_amount: String,
    location: String,
    embedding: V<768>,
}

// Edge connecting a candidate to matched startups
E::MatchedTo {
    From: Candidate,
    To: Startup,
    Properties: {
        score: F64,
        matched_at: String,
    }
}
