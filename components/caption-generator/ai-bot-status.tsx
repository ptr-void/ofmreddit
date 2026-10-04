"use client"

import { Bot, ThumbsUp, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"

interface AiBotStatusProps {
  isGenerating: boolean
  message: string
  showSuccess?: boolean
}

export function AiBotStatus({ isGenerating, message, showSuccess = false }: AiBotStatusProps) {
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    if (!showSuccess) {
      setIsSuccess(false)
      return
    }
    if (showSuccess) {
      setIsSuccess(true)
      const timer = setTimeout(() => {
        setIsSuccess(false)
      }, 2000) 
      return () => clearTimeout(timer)
    }
  }, [showSuccess])

  return (
    <div className="mb-6 p-4 bg-gradient-to-br from-primary/20 to-primary/10 rounded-lg border border-border">
      <div className="flex items-center justify-center gap-3 flex-col text-center">
        <div className="relative">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center text-primary-foreground transition-all duration-500 ${
              isSuccess ? "bg-green-500 scale-110 animate-[wiggle_0.5s_ease-in-out]" : "bg-primary"
            } ${isGenerating ? "animate-bounce" : ""}`}
          >
            {isSuccess ? (
              <ThumbsUp className="w-6 h-6 animate-[thumbsUp_0.5s_ease-in-out]" />
            ) : (
              <Bot className="w-6 h-6" />
            )}
          </div>

          {isGenerating && (
            <>
              <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse" />
            </>
          )}

          {isSuccess && (
            <>
              <Sparkles className="absolute -top-2 -right-2 w-5 h-5 text-yellow-400 animate-[sparkle_0.6s_ease-in-out]" />
              <Sparkles className="absolute -bottom-2 -left-2 w-4 h-4 text-yellow-400 animate-[sparkle_0.6s_ease-in-out_0.2s]" />
              <div className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" />
            </>
          )}

          {isGenerating && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>

        <p className="text-sm text-foreground leading-relaxed">{message}</p>
      </div>
    </div>
  )
}
