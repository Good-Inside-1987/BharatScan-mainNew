import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { DataContextProvider } from "@/context/DataContext";
import Home from "./pages/Home";
import ScannerDashboard from "./pages/ScannerDashboard";
import Index from "./pages/Index";
import StrategiesBacktest from "./pages/StrategiesBacktest";
import Portfolio from "./pages/Portfolio";
import SavedScan from "./pages/SavedScan";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import OptionsAnalysis from "./pages/Options";
import PaperTrading from "./pages/PaperTrading";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <DataContextProvider>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/scanner-dashboard" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/scanner-dashboard" element={<ScannerDashboard />} />
            <Route path="/create-scan" element={<Index />} />
            <Route path="/strategies-backtest" element={<StrategiesBacktest />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/saved-scan" element={<SavedScan />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/options" element={<OptionsAnalysis />} />
            <Route path="/paper-trading" element={<PaperTrading />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
        </DataContextProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
