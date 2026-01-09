import React from "react";
import { Plugin } from "../../core/types";

interface PluginListProps {
    plugins: Plugin[];
}

export const PluginList: React.FC<PluginListProps> = ({ plugins }) => {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                height: "100%",
                background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
                padding: "60px",
                fontFamily: '"MiSans", "Roboto Slab", sans-serif',
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    marginBottom: "50px",
                }}
            >
                <h1
                    style={{
                        fontSize: "56px",
                        fontWeight: "800",
                        color: "#2c3e50",
                        marginBottom: "10px",
                        textShadow: "2px 2px 4px rgba(0,0,0,0.1)",
                    }}
                >
                    Plugin List
                </h1>
                <div
                    style={{
                        display: "flex",
                        fontSize: "24px",
                        color: "#5f6c7b",
                        backgroundColor: "rgba(255,255,255,0.6)",
                        padding: "5px 20px",
                        borderRadius: "20px",
                    }}
                >
                    Total: {plugins.length}
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "25px",
                }}
            >
                {plugins.map((p, index) => (
                    <div
                        key={index}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            padding: "25px",
                            borderRadius: "16px",
                            boxShadow: "0 10px 20px rgba(0,0,0,0.05), 0 2px 6px rgba(0,0,0,0.05)",
                            border: "1px solid rgba(255,255,255,0.8)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "12px",
                                borderBottom: "1px solid #eee",
                                paddingBottom: "12px",
                            }}
                        >
                            <span
                                style={{
                                    fontSize: "32px",
                                    fontWeight: "bold",
                                    color: "#34495e",
                                    letterSpacing: "-0.5px",
                                }}
                            >
                                {p.meta.name}
                            </span>
                            <span
                                style={{
                                    fontSize: "18px",
                                    fontWeight: "600",
                                    color: "#3498db",
                                    backgroundColor: "#ebf5fb",
                                    padding: "6px 16px",
                                    borderRadius: "20px",
                                    border: "1px solid #d6eaf8",
                                }}
                            >
                                v{p.meta.version}
                            </span>
                        </div>
                        <div
                            style={{
                                fontSize: "22px",
                                color: "#5d6d7e",
                                lineHeight: "1.5",
                            }}
                        >
                            {p.meta.description || "No description available"}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
