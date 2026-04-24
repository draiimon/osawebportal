import React from "react";
import { ArrowRight, ChevronRight, Download, FileText, Search, User, Menu, Bell, MessageSquare, Calendar, Info, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import "./_group.css";

export function TransactionDashboard() {
  return (
    <div className="osa-root flex flex-col min-h-screen">
      {/* 1. Top Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-[var(--osa-line)] bg-[var(--osa-cream)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--osa-cream)]/60">
        <div className="max-w-[1180px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="#" className="flex items-center gap-2 font-bold text-[var(--osa-maroon)] text-lg tracking-tight">
              <div className="w-8 h-8 bg-[var(--osa-maroon)] rounded-sm flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-[var(--osa-gold)] rounded-full"></div>
              </div>
              EAC OSA
            </a>
            <nav className="hidden md:flex gap-6">
              <a href="#" className="text-[var(--osa-ink)] font-semibold text-sm hover:text-[var(--osa-maroon)] transition-colors">Home</a>
              <a href="#" className="text-[var(--osa-ink-soft)] font-medium text-sm hover:text-[var(--osa-maroon)] transition-colors">Announcements</a>
              <a href="#" className="text-[var(--osa-ink-soft)] font-medium text-sm hover:text-[var(--osa-maroon)] transition-colors">Lost & Found</a>
              <a href="#" className="text-[var(--osa-ink-soft)] font-medium text-sm hover:text-[var(--osa-maroon)] transition-colors">About Portal</a>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 mr-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--osa-ink-soft)]">
                <Search className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--osa-ink-soft)] relative">
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--osa-maroon)] rounded-full"></span>
              </Button>
            </div>
            <a href="#" className="text-[var(--osa-maroon)] font-semibold text-sm hover:underline hidden md:block">Sign in</a>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5 text-[var(--osa-ink)]" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 2. Hero Section - Transaction Status Board */}
        <section className="pt-12 pb-16 px-6 border-b border-[var(--osa-line)] bg-gradient-to-b from-transparent to-[var(--osa-cream)]/50">
          <div className="max-w-[1180px] mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl md:text-4xl font-bold text-[var(--osa-ink)] mb-2 tracking-tight">
                Good morning, Maria.
              </h1>
              <p className="text-[var(--osa-ink-soft)] text-lg">
                Here's what's moving with your OSA requests.
              </p>
            </div>

            {/* Status Strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Transaction 1 */}
              <div className="bg-white border border-[var(--osa-line)] border-l-4 border-l-[var(--osa-maroon)] p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-xs font-bold text-[var(--osa-ink-soft)] tracking-wider uppercase">Good Moral Certificate</span>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Step 3 of 4</Badge>
                </div>
                <h3 className="font-bold text-[var(--osa-ink)] mb-3 text-sm">Ready for pickup at OSA window 2</h3>
                
                {/* Progress Bar */}
                <div className="flex gap-1 mb-4">
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-gold-soft)] rounded-full"></div>
                </div>
                
                <div className="pt-3 border-t border-[var(--osa-line)]">
                  <a href="#" className="text-sm font-semibold text-[var(--osa-maroon)] hover:text-[var(--osa-gold)] flex items-center gap-1 group">
                    View pickup details <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                </div>
              </div>

              {/* Transaction 2 */}
              <div className="bg-white border border-[var(--osa-line)] border-l-4 border-l-[var(--osa-maroon)] p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-xs font-bold text-[var(--osa-ink-soft)] tracking-wider uppercase">ID Replacement</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Step 2 of 4</Badge>
                </div>
                <h3 className="font-bold text-[var(--osa-ink)] mb-3 text-sm">Awaiting your photo upload (due Apr 26)</h3>
                
                {/* Progress Bar */}
                <div className="flex gap-1 mb-4">
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-gold-soft)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-gold-soft)] rounded-full"></div>
                </div>
                
                <div className="pt-3 border-t border-[var(--osa-line)]">
                  <a href="#" className="text-sm font-semibold text-[var(--osa-maroon)] hover:text-[var(--osa-gold)] flex items-center gap-1 group">
                    Upload photo <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                </div>
              </div>

              {/* Transaction 3 */}
              <div className="bg-white border border-[var(--osa-line)] border-l-4 border-l-[var(--osa-maroon)] p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-xs font-bold text-[var(--osa-ink-soft)] tracking-wider uppercase">Lost item claim &middot; Black umbrella</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Step 1 of 3</Badge>
                </div>
                <h3 className="font-bold text-[var(--osa-ink)] mb-3 text-sm">Verification email sent — open the link to confirm ownership</h3>
                
                {/* Progress Bar */}
                <div className="flex gap-1 mb-4">
                  <div className="h-1.5 flex-1 bg-[var(--osa-maroon)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-gold-soft)] rounded-full"></div>
                  <div className="h-1.5 flex-1 bg-[var(--osa-gold-soft)] rounded-full"></div>
                </div>
                
                <div className="pt-3 border-t border-[var(--osa-line)]">
                  <a href="#" className="text-sm font-semibold text-[var(--osa-maroon)] hover:text-[var(--osa-gold)] flex items-center gap-1 group">
                    Open verification <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                </div>
              </div>
            </div>

            {/* Secondary Band */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--osa-ink-soft)] bg-white/50 px-4 py-2 rounded-sm border border-[var(--osa-line)]">
                <span className="font-bold text-[var(--osa-ink)]">Today at OSA</span>
                <span className="w-1 h-1 rounded-full bg-[var(--osa-line)]"></span>
                <span>Window hours 9:00 – 16:00</span>
                <span className="w-1 h-1 rounded-full bg-[var(--osa-line)]"></span>
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> 12 students currently being assisted</span>
                <span className="w-1 h-1 rounded-full bg-[var(--osa-line)]"></span>
                <span>Avg wait 6 min</span>
              </div>
              
              <Button variant="ghost" className="osa-btn--ghost text-sm self-start sm:self-auto">
                Start a new request
              </Button>
            </div>

            {/* Anonymous hint (visualized at bottom of hero) */}
            <div className="mt-8 text-center text-sm text-[var(--osa-ink-soft)]">
              Not signed in? <a href="#services" className="text-[var(--osa-maroon)] font-semibold hover:underline">See the most-used services this week &rarr;</a>
            </div>

          </div>
        </section>

        {/* 3. OSA Services Strip */}
        <section id="services" className="py-16 px-6">
          <div className="max-w-[1180px] mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-[var(--osa-ink)] tracking-tight">OSA Services</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-none border-[var(--osa-line)] text-[var(--osa-ink-soft)]">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-none border-[var(--osa-line)] text-[var(--osa-ink-soft)]">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <div className="flex overflow-x-auto pb-6 -mx-6 px-6 snap-x snap-mandatory gap-4 scrollbar-hide">
              {[
                { title: "Student Conduct & Discipline", desc: "OSA attends to student conduct and discipline in line with college policies—consistent with the OSA mandate on student life and welfare." },
                { title: "Lost & Found", desc: "Coordinates logging and release of found items reported on campus through OSA, so students have a single office to report or claim property." },
                { title: "ID Processing", desc: "School ID services for new students, replacement, and updates are processed through OSA following campus procedures and posted requirements." },
                { title: "Scholarship Applications & Inquiries", desc: "Assistance with scholarship applications and inquiries, including requirements and schedules published by the institution." },
                { title: "Good Moral Character Certificate", desc: "OSA processes requests for Good Moral Character certificates and related clearance documentation according to published procedures." },
                { title: "ISO & PACUCOA Accreditation", desc: "Student-affairs support tied to institutional quality assurance and accreditation, coordinated through OSA as the liaison for student-facing requirements." },
                { title: "Learner Activity Program (LAAP)", desc: "OSA supports co-curricular and student activities under LAAP—aligning programs with institutional guidelines and student organization rules." }
              ].map((service, i) => (
                <Card key={i} className="min-w-[280px] max-w-[280px] snap-start border-[var(--osa-line)] rounded-none shadow-sm hover:shadow-md transition-shadow bg-white flex flex-col h-full">
                  <CardContent className="p-6 flex flex-col h-full">
                    <h3 className="font-bold text-[var(--osa-ink)] mb-3 leading-tight">{service.title}</h3>
                    <p className="text-sm text-[var(--osa-ink-soft)] leading-relaxed mb-6 flex-grow">{service.desc}</p>
                    <a href="#" className="text-sm font-semibold text-[var(--osa-maroon)] hover:text-[var(--osa-gold)] flex items-center gap-1 group mt-auto">
                      View details <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </a>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Student Manual Highlight */}
        <section className="py-12 px-6 bg-white border-y border-[var(--osa-line)]">
          <div className="max-w-[1180px] mx-auto">
            <div className="grid md:grid-cols-12 gap-8 items-center">
              <div className="md:col-span-4 lg:col-span-3 flex justify-center md:justify-start">
                <div className="w-48 h-64 bg-[var(--osa-maroon)] border-4 border-white outline outline-1 outline-[var(--osa-line)] shadow-lg relative flex flex-col items-center justify-center p-4 text-center">
                  <div className="absolute top-4 left-0 right-0 h-1 bg-[var(--osa-gold)] opacity-80"></div>
                  <div className="w-12 h-12 border-2 border-[var(--osa-gold)] rounded-full mb-4 opacity-80 flex items-center justify-center">
                    <div className="w-8 h-8 bg-[var(--osa-gold)] rounded-full opacity-20"></div>
                  </div>
                  <h4 className="text-white font-serif font-bold leading-tight mb-2">EAC-C<br/>Student<br/>Manual</h4>
                  <p className="text-[var(--osa-gold)] text-xs font-semibold tracking-widest uppercase">2021</p>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-9">
                <Badge variant="outline" className="mb-4 text-[var(--osa-maroon)] border-[var(--osa-maroon-soft)] rounded-none px-3 py-1 font-bold tracking-wide uppercase text-xs">
                  Primary reference document
                </Badge>
                <h2 className="text-3xl font-bold text-[var(--osa-ink)] mb-4 tracking-tight">EAC-C Student Manual</h2>
                <p className="text-[var(--osa-ink-soft)] text-lg mb-8 max-w-2xl leading-relaxed">
                  The official guide to student life, policies, disciplinary procedures, and institutional guidelines at Emilio Aguinaldo College – Cavite.
                </p>
                <div className="flex flex-wrap gap-4">
                  <Button className="osa-btn osa-btn--primary">
                    <FileText className="w-4 h-4" /> Open Student Manual (PDF)
                  </Button>
                  <Button variant="outline" className="osa-btn osa-btn--neutral">
                    <Download className="w-4 h-4" /> Download Forms
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Module Pages Mini-grid */}
        <section className="py-16 px-6">
          <div className="max-w-[1180px] mx-auto">
            <h2 className="text-2xl font-bold text-[var(--osa-ink)] tracking-tight mb-8">More from OSA</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { title: "Announcements / News", desc: "Official memorandums, advisories, and campus updates from the Office of Student Affairs.", icon: Bell },
                { title: "Lost & Found Board", desc: "Browse a live registry of items found on campus or report a lost item to the OSA office.", icon: Search },
                { title: "About Portal", desc: "Learn how the OSA Transaction Guide Portal works and how it integrates with campus services.", icon: Info }
              ].map((module, i) => (
                <div key={i} className="border border-[var(--osa-line)] bg-white p-6 hover:shadow-md transition-shadow group flex flex-col">
                  <div className="w-10 h-10 rounded bg-[var(--osa-cream)] border border-[var(--osa-line)] flex items-center justify-center mb-4 text-[var(--osa-maroon)]">
                    <module.icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-[var(--osa-ink)] text-lg mb-2">{module.title}</h3>
                  <p className="text-sm text-[var(--osa-ink-soft)] mb-6 flex-grow">{module.desc}</p>
                  <Button variant="outline" className="osa-btn--ghost w-full justify-center group-hover:bg-[var(--osa-maroon-soft)]">
                    Open page
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* 6. Footer */}
      <footer className="border-t border-[var(--osa-line)] bg-white py-12 px-6">
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-2 font-bold text-[var(--osa-maroon)] text-lg tracking-tight">
              <div className="w-6 h-6 bg-[var(--osa-maroon)] rounded-sm flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-[var(--osa-gold)] rounded-full"></div>
              </div>
              EAC OSA
            </div>
            <p className="text-sm text-[var(--osa-ink-soft)]">Office of Student Affairs &middot; EAC Cavite</p>
            <p className="text-xs text-[var(--osa-ink-soft)] mt-2">&copy; {new Date().getFullYear()} Emilio Aguinaldo College. All rights reserved.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm font-medium text-[var(--osa-ink-soft)]">
            <a href="#" className="hover:text-[var(--osa-maroon)] transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-[var(--osa-maroon)] transition-colors">Accessibility</a>
            <a href="#" className="hover:text-[var(--osa-maroon)] transition-colors">Contact OSA</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ChevronLeft(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
