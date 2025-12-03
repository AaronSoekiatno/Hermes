-- Add resume_path column to candidates table to store path to resume file in Storage
alter table public.candidates
add column if not exists resume_path text;


