export interface Directive {
    command: string;
    args: string;
    pos: {
        start: number;
        end: number;
    }
}

const regex = /^[\t ]*--[\t ]*#(?<command>[^\s]+)[\t ]*(?<args>[^\r\n]*)[\t ]*$/gm
export function parseDirectives(content: string): Directive[] {
    const matches = [...content.matchAll(regex)]
    return matches.map(
        match => {
            const command = match.groups.command;
            const args = match.groups.args;
            const start = match.index
            const end = start + match[0].length
            return {
                command,
                args,
                pos: {
                    start,
                    end,
                }
            }
        }
    )
}
