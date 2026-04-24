import * as React from "react";
import { MessageSquare, Search, Send, Mic, FileText, ChevronRight, Download, Book, AlertCircle, FileQuestion, Users, ShieldCheck, GraduationCap, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

import "./_group.css";

export function ConversationalHero() {
  return (
    <div className="osa-root min-h-screen flex flex-col font-['Plus_Jakarta_Sans']">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#fffdf9]/95 backdrop-blur-md border-b border-[#841a2d]/10">
        <div className="max-w-[1180px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#841a2d] flex items-center justify-center text-white font-bold text-lg">
              E
            </div>
            <span className="font-bold text-[#2c1a15] text-lg tracking-tight">
              EAC OSA
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#66534a]">
            <a href="#" className="text-[#841a2d]">Home</a>
            <a href="#" className="hover:text-[#841a2d] transition-colors">Announcements</a>
            <a href="#" className="hover:text-[#841a2d] transition-colors">Lost & Found</a>
            <a href="#" className="hover:text-[#841a2d] transition-colors">About Portal</a>
          </nav>
          <div className="flex items-center gap-4">
            <a href="#" className="text-sm font-medium text-[#66534a] hover:text-[#841a2d] hidden sm:block">Sign in</a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section - Conversational variant */}
        <section className="relative pt-16 pb-20 px-6">
          <div className="max-w-[800px] mx-auto flex flex-col items-center text-center">
            
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#2c1a15] mb-4 tracking-tight">
              Hi, I'm Ask OSA. What can I help you with today?
            </h1>
            <p className="text-lg text-[#66534a] mb-10 max-w-[600px]">
              I can guide you through OSA services step-by-step — clearances, lost items,
              scholarships, IDs, and more.
            </p>

            <div className="w-full text-left mb-6">
              <div className="flex items-center gap-2 mb-3 px-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-xs font-bold text-[#66534a] uppercase tracking-wider">Ask OSA · Live</span>
              </div>
              <div className="bg-[#fffdf9] border-l-4 border-[#841a2d] border-y border-r border-[#841a2d]/10 p-5 shadow-sm">
                <p className="text-[#2c1a15] font-medium mb-3 text-sm">To claim a lost item, please follow these steps:</p>
                <ol className="list-decimal pl-5 text-sm text-[#66534a] space-y-1.5">
                  <li>Check the Lost & Found Board to see if your item has been logged.</li>
                  <li>Prepare a valid ID and proof of ownership (like a photo or detailed description).</li>
                  <li>Visit the OSA office during working hours to claim it.</li>
                </ol>
              </div>
            </div>

            <div className="w-full bg-white rounded-xl shadow-[0_8px_30px_rgb(50,25,14,0.06)] border border-[#841a2d]/10 overflow-hidden mb-4">
              <Textarea 
                placeholder="Tell me what you need… e.g. 'I lost my ID this morning' or 'How do I request my Good Moral?'"
                className="min-h-[120px] w-full resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-5 text-base md:text-lg bg-transparent rounded-none"
              />
              <div className="bg-[#fcfaf7] px-4 py-3 flex items-center justify-between border-t border-[#841a2d]/5">
                <button className="p-2 text-[#66534a] hover:text-[#841a2d] hover:bg-[#841a2d]/5 rounded-md transition-colors">
                  <Mic className="w-5 h-5" />
                </button>
                <button className="osa-btn osa-btn--primary py-2 px-5 rounded-md flex items-center gap-2">
                  <span className="font-semibold">Send</span>
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="w-full mb-6">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {[
                  "How do I claim a lost item?",
                  "I need a Good Moral certificate for my OJT.",
                  "When do scholarship applications open?",
                  "How do I report an incident?",
                  "My ID was damaged — what now?",
                  "Do you have the LAAP guidelines?"
                ].map((prompt, i) => (
                  <button key={i} className="px-4 py-2 rounded-full border border-[#841a2d]/15 bg-[#fffdf9] text-sm text-[#66534a] hover:border-[#841a2d]/40 hover:text-[#841a2d] hover:bg-[#841a2d]/5 transition-all whitespace-nowrap">
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs text-[#66534a]/70 flex items-center justify-center gap-1 mb-2">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified responses · OTP-protected when needed · No personal data stored without your consent.
              </p>
              <p className="text-[11px] text-[#66534a]/50">
                Prefer the floating widget? It's still there in the corner.
              </p>
            </div>

          </div>
        </section>

        {/* OSA Services Strip */}
        <section className="py-16 bg-white border-y border-[#841a2d]/5 overflow-hidden">
          <div className="max-w-[1180px] mx-auto px-6 mb-8">
            <h2 className="text-2xl font-bold text-[#2c1a15]">OSA Services</h2>
            <p className="text-[#66534a]">Core support functions provided by the Office of Student Affairs.</p>
          </div>
          <div className="max-w-[1180px] mx-auto px-6">
            <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory hide-scrollbar">
              {[
                { title: "Student Conduct & Discipline", desc: "OSA attends to student conduct and discipline in line with college policies—consistent with the OSA mandate on student life and welfare.", icon: AlertCircle },
                { title: "Lost & Found", desc: "Coordinates logging and release of found items reported on campus through OSA, so students have a single office to report or claim property.", icon: Search },
                { title: "ID Processing", desc: "School ID services for new students, replacement, and updates are processed through OSA following campus procedures and posted requirements.", icon: FileText },
                { title: "Scholarship Applications", desc: "Assistance with scholarship applications and inquiries, including requirements and schedules published by the institution.", icon: Award },
                { title: "Good Moral Character Certificate", desc: "OSA processes requests for Good Moral Character certificates and related clearance documentation according to published procedures.", icon: FileQuestion },
                { title: "ISO/PACUCOA Accreditation", desc: "Student-affairs support tied to institutional quality assurance and accreditation, coordinated through OSA as the liaison for student-facing requirements.", icon: ShieldCheck },
                { title: "Learner Activity Program (LAAP)", desc: "OSA supports co-curricular and student activities under LAAP—aligning programs with institutional guidelines and student organization rules.", icon: Users }
              ].map((service, i) => (
                <div key={i} className="min-w-[280px] w-[280px] snap-start bg-[#fffdf9] border border-[#841a2d]/10 p-6 hover:shadow-md transition-shadow">
                  <service.icon className="w-8 h-8 text-[#c79a49] mb-4" />
                  <h3 className="font-bold text-[#2c1a15] mb-2">{service.title}</h3>
                  <p className="text-sm text-[#66534a] line-clamp-3 leading-relaxed">{service.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Student Manual Highlight */}
        <section className="py-20 px-6">
          <div className="max-w-[1180px] mx-auto">
            <div className="bg-[#841a2d] text-white p-1 md:p-12 overflow-hidden relative">
              {/* Decorative radial */}
              <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#c79a49] rounded-full blur-[100px] opacity-20 -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
              
              <div className="relative z-10 flex flex-col md:flex-row gap-10 items-center p-8 md:p-0">
                <div className="w-48 shrink-0 flex justify-center">
                  <div className="w-40 h-56 bg-[#fffdf9] border-l-8 border-[#c79a49] shadow-2xl flex flex-col items-center justify-center p-4 text-center transform -rotate-2">
                    <div className="w-12 h-12 bg-[#841a2d] mb-4 flex items-center justify-center text-white font-bold">E</div>
                    <span className="font-bold text-[#841a2d] text-sm uppercase tracking-widest leading-tight">EAC-C<br/>Student<br/>Manual<br/><span className="text-[#c79a49]">2021</span></span>
                  </div>
                </div>
                <div>
                  <Badge variant="outline" className="text-[#c79a49] border-[#c79a49]/30 mb-4 bg-black/10">Primary reference document</Badge>
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">EAC-C Student Manual</h2>
                  <p className="text-white/80 mb-8 max-w-2xl text-lg">
                    The comprehensive guide to student life, academic policies, conduct guidelines, and campus services at Emilio Aguinaldo College – Cavite.
                  </p>
                  <button className="bg-[#c79a49] hover:bg-[#d8a855] text-[#2c1a15] font-bold py-3 px-6 transition-colors flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Open Student Manual (PDF)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Module Pages Mini-Grid */}
        <section className="py-16 bg-[#fffdf9] px-6">
          <div className="max-w-[1180px] mx-auto">
            <h2 className="text-2xl font-bold text-[#2c1a15] mb-8 text-center">Explore the Portal</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-[#841a2d]/10 bg-white hover:border-[#841a2d]/30 transition-colors rounded-none shadow-sm">
                <CardContent className="p-6">
                  <MessageSquare className="w-6 h-6 text-[#841a2d] mb-4" />
                  <h3 className="font-bold text-lg text-[#2c1a15] mb-2">Announcements / News</h3>
                  <p className="text-sm text-[#66534a] mb-6 min-h-[40px]">Stay updated with the latest news, advisories, and memos from the OSA.</p>
                  <button className="osa-btn osa-btn--ghost w-full">Open page</button>
                </CardContent>
              </Card>
              
              <Card className="border-[#841a2d]/10 bg-white hover:border-[#841a2d]/30 transition-colors rounded-none shadow-sm">
                <CardContent className="p-6">
                  <Search className="w-6 h-6 text-[#841a2d] mb-4" />
                  <h3 className="font-bold text-lg text-[#2c1a15] mb-2">Lost & Found Board</h3>
                  <p className="text-sm text-[#66534a] mb-6 min-h-[40px]">Browse found items logged with the office or report a lost item securely.</p>
                  <button className="osa-btn osa-btn--ghost w-full">Open page</button>
                </CardContent>
              </Card>

              <Card className="border-[#841a2d]/10 bg-white hover:border-[#841a2d]/30 transition-colors rounded-none shadow-sm">
                <CardContent className="p-6">
                  <Book className="w-6 h-6 text-[#841a2d] mb-4" />
                  <h3 className="font-bold text-lg text-[#2c1a15] mb-2">About Portal</h3>
                  <p className="text-sm text-[#66534a] mb-6 min-h-[40px]">Learn about the OSA Transaction Guide Portal and its data privacy policies.</p>
                  <button className="osa-btn osa-btn--ghost w-full">Open page</button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-[#841a2d]/10 py-10 px-6">
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded bg-[#841a2d] flex items-center justify-center text-white font-bold text-xs">
                E
              </div>
              <span className="font-bold text-[#2c1a15]">EAC OSA</span>
            </div>
            <p className="text-sm text-[#66534a]">Office of Student Affairs · EAC Cavite</p>
            <p className="text-xs text-[#66534a]/70 mt-1">© {new Date().getFullYear()} Emilio Aguinaldo College. All rights reserved.</p>
          </div>
          <div className="flex gap-6 text-sm text-[#66534a]">
            <a href="#" className="hover:text-[#841a2d] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[#841a2d] transition-colors">Accessibility</a>
            <a href="#" className="hover:text-[#841a2d] transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
