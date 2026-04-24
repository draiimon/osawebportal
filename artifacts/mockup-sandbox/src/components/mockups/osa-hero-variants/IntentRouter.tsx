import React, { useState } from "react";
import { Search, ScrollText, GraduationCap, IdCard, FileWarning, Megaphone, CheckCircle2, ChevronRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import "./_group.css";

export function IntentRouter() {
  const [searchValue, setSearchValue] = useState("");

  const intents = [
    { icon: ScrollText, label: "Get a Good Moral Certificate" },
    { icon: Search, label: "Claim a Lost & Found item" },
    { icon: GraduationCap, label: "Apply for a scholarship" },
    { icon: IdCard, label: "Request / replace ID" },
    { icon: FileWarning, label: "File an incident report" },
    { icon: Megaphone, label: "See latest announcements" },
  ];

  const services = [
    { title: "Student Conduct & Discipline", desc: "OSA attends to student conduct and discipline in line with college policies—consistent with the OSA mandate on student life and welfare." },
    { title: "Lost & Found", desc: "Coordinates logging and release of found items reported on campus through OSA, so students have a single office to report or claim property." },
    { title: "ID Processing", desc: "School ID services for new students, replacement, and updates are processed through OSA following campus procedures and posted requirements." },
    { title: "Scholarship Applications", desc: "Assistance with scholarship applications and inquiries, including requirements and schedules published by the institution." },
    { title: "Good Moral Certificate", desc: "OSA processes requests for Good Moral Character certificates and related clearance documentation according to published procedures." },
    { title: "ISO / PACUCOA", desc: "Student-affairs support tied to institutional quality assurance and accreditation, coordinated through OSA as the liaison for student-facing requirements." },
    { title: "Learner Activity Program", desc: "OSA supports co-curricular and student activities under LAAP—aligning programs with institutional guidelines and student organization rules." },
  ];

  return (
    <div className="osa-root min-h-screen flex flex-col font-['Plus_Jakarta_Sans']">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-[var(--osa-line)] bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1180px] px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--osa-maroon)] flex items-center justify-center text-white font-bold text-xs">
              EAC
            </div>
            <span className="font-bold text-[var(--osa-ink)] tracking-tight">EAC OSA</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[var(--osa-ink-soft)]">
            <a href="#" className="text-[var(--osa-maroon)]">Home</a>
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">Announcements</a>
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">Lost & Found</a>
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">About Portal</a>
          </nav>

          <div className="flex items-center gap-4">
            <a href="#" className="hidden md:inline-flex text-sm font-semibold text-[var(--osa-ink)] hover:text-[var(--osa-maroon)] transition-colors">
              Sign in
            </a>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-24 px-6 relative overflow-hidden">
          {/* Subtle background decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[var(--osa-gold)]/5 blur-[120px] rounded-full pointer-events-none" />
          
          <div className="mx-auto max-w-[800px] relative z-10 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--osa-maroon)]" />
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--osa-maroon)]">
                Office of Student Affairs · EAC Cavite
              </span>
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--osa-maroon)]" />
            </div>

            <div className="w-full relative group mb-8">
              <div className="absolute inset-0 bg-[var(--osa-maroon)]/5 rounded-2xl blur-xl group-focus-within:bg-[var(--osa-maroon)]/10 transition-colors duration-500" />
              <div className="relative flex items-center bg-white rounded-2xl shadow-sm border-2 border-transparent hover:border-[var(--osa-maroon)]/20 focus-within:border-[var(--osa-maroon)] focus-within:shadow-md transition-all duration-300 overflow-hidden">
                <div className="pl-6 text-[var(--osa-ink-soft)]">
                  <Search className="w-6 h-6" />
                </div>
                <Input 
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="What do you need from OSA today?" 
                  className="flex-1 h-16 border-0 focus-visible:ring-0 text-lg px-4 bg-transparent placeholder:text-[var(--osa-ink-soft)]/50 font-medium"
                />
                <div className="pr-3">
                  <Button className="h-10 px-8 rounded-xl bg-[var(--osa-maroon)] hover:bg-[var(--osa-maroon)]/90 text-white font-bold text-base shadow-sm">
                    Ask
                  </Button>
                </div>
              </div>
            </div>

            <div className="w-full">
              <div className="flex flex-wrap justify-center gap-2.5 mb-6">
                {intents.map((intent, i) => (
                  <button 
                    key={i}
                    onClick={() => setSearchValue(intent.label)}
                    className="inline-flex items-center gap-2 bg-white/60 hover:bg-white border border-[var(--osa-maroon)]/10 hover:border-[var(--osa-maroon)]/30 px-4 py-2.5 rounded-full text-sm font-medium text-[var(--osa-ink)] transition-all hover:-translate-y-0.5 hover:shadow-sm"
                  >
                    <intent.icon className="w-4 h-4 text-[var(--osa-maroon)]" />
                    {intent.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-[var(--osa-ink-soft)]">
                Start typing or pick a common request — Ask OSA will guide you the rest of the way.
              </p>
            </div>

            <div className="mt-12 flex items-center justify-center gap-2 text-xs font-medium text-[var(--osa-ink-soft)] bg-white/50 backdrop-blur-sm border border-[var(--osa-line)] py-2 px-4 rounded-full">
              <div className="relative flex items-center justify-center w-2 h-2 mr-1">
                <div className="absolute w-full h-full bg-emerald-500 rounded-full animate-ping opacity-75"></div>
                <div className="relative w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
              </div>
              Live · 24 students helped today
            </div>
          </div>
        </section>

        {/* Services Strip */}
        <section className="py-16 px-6 bg-white/50 border-y border-[var(--osa-line)]">
          <div className="mx-auto max-w-[1180px]">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold tracking-tight text-[var(--osa-ink)]">OSA Services</h2>
            </div>
            
            <div className="flex overflow-x-auto gap-4 pb-4 -mx-6 px-6 md:mx-0 md:px-0 snap-x snap-mandatory hide-scrollbar">
              {services.map((service, i) => (
                <Card key={i} className="min-w-[280px] w-[280px] shrink-0 snap-start rounded-xl border-[var(--osa-line)] bg-white shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <h3 className="font-bold text-[var(--osa-ink)] mb-2 text-base leading-tight">{service.title}</h3>
                    <p className="text-sm text-[var(--osa-ink-soft)] leading-relaxed line-clamp-3">
                      {service.desc}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Student Manual + Modules */}
        <section className="py-20 px-6">
          <div className="mx-auto max-w-[1180px] grid md:grid-cols-12 gap-8">
            {/* Manual Highlight */}
            <div className="md:col-span-8">
              <Card className="h-full rounded-2xl overflow-hidden border-[var(--osa-line)] bg-white shadow-sm">
                <div className="flex flex-col sm:flex-row h-full">
                  <div className="sm:w-[240px] bg-[var(--osa-maroon)] p-8 flex items-center justify-center relative overflow-hidden shrink-0">
                    <div className="absolute inset-0 bg-[var(--osa-gold)]/10" />
                    <div className="relative w-full aspect-[3/4] bg-[var(--osa-cream)] shadow-xl rounded border-4 border-white/10 flex flex-col items-center justify-center p-4 text-center">
                      <div className="w-8 h-8 rounded-full bg-[var(--osa-maroon)] flex items-center justify-center text-white font-bold text-[10px] mb-3">EAC</div>
                      <div className="font-serif font-bold text-[var(--osa-maroon)] text-sm leading-tight border-y border-[var(--osa-maroon)]/20 py-2 w-full">
                        EAC-C<br/>Student<br/>Manual
                      </div>
                      <div className="mt-auto text-[10px] font-bold text-[var(--osa-ink-soft)] uppercase tracking-wider">2021</div>
                    </div>
                  </div>
                  <div className="p-8 md:p-10 flex flex-col justify-center flex-1">
                    <Badge variant="outline" className="w-fit mb-4 text-[var(--osa-maroon)] border-[var(--osa-maroon)]/20 bg-[var(--osa-maroon)]/5">
                      Primary reference document
                    </Badge>
                    <h3 className="text-2xl font-bold text-[var(--osa-ink)] mb-3">EAC-C Student Manual</h3>
                    <p className="text-[var(--osa-ink-soft)] mb-8 leading-relaxed">
                      The definitive guide to student life, academic policies, code of conduct, and your rights and responsibilities as an EAC student.
                    </p>
                    <div className="mt-auto">
                      <Button className="bg-[var(--osa-maroon)] hover:bg-[var(--osa-maroon)]/90 text-white rounded-lg px-6 h-11 font-semibold">
                        Open Student Manual (PDF)
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Modules Mini-grid */}
            <div className="md:col-span-4 flex flex-col gap-4">
              {[
                { title: "Announcements / News", desc: "Official memorandums and campus updates." },
                { title: "Lost & Found Board", desc: "Search reported items or file a claim." },
                { title: "About Portal", desc: "Learn how the OSA platform works." }
              ].map((module, i) => (
                <Card key={i} className="flex-1 rounded-xl border-[var(--osa-line)] bg-white shadow-sm hover:border-[var(--osa-maroon)]/30 transition-colors group cursor-pointer">
                  <CardContent className="p-5 flex flex-col h-full justify-center">
                    <h4 className="font-bold text-[var(--osa-ink)] mb-1 group-hover:text-[var(--osa-maroon)] transition-colors">{module.title}</h4>
                    <p className="text-sm text-[var(--osa-ink-soft)] mb-4">{module.desc}</p>
                    <div className="mt-auto flex items-center text-sm font-semibold text-[var(--osa-maroon)]">
                      Open page <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--osa-line)] bg-white py-12 px-6">
        <div className="mx-auto max-w-[1180px] flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--osa-maroon)] flex items-center justify-center text-white font-bold text-xs opacity-80">
              EAC
            </div>
            <div>
              <div className="font-bold text-[var(--osa-ink)]">Office of Student Affairs</div>
              <div className="text-xs text-[var(--osa-ink-soft)]">EAC Cavite</div>
            </div>
          </div>
          
          <div className="text-sm text-[var(--osa-ink-soft)] text-center md:text-left">
            &copy; {new Date().getFullYear()} Emilio Aguinaldo College. All rights reserved.
          </div>

          <div className="flex gap-6 text-sm font-medium text-[var(--osa-ink-soft)]">
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">Accessibility</a>
            <a href="#" className="hover:text-[var(--osa-ink)] transition-colors">Contact</a>
          </div>
        </div>
      </footer>

      {/* Basic hide-scrollbar utility */}
      <style dangerouslySetInline={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
}
