import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { isProduction } from '../config.js';
import { listDemoAccounts, listWorkspacesFor, upsertUserByEmail } from '../repo.js';
import { getDb } from '../db.js';
import { issueSession } from '../tokens.js';

export class SignInDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

/**
 * Sign-in.
 *
 * There is no password parameter and there will not be one. In production this
 * endpoint hands off to an identity provider and the server stores only the
 * external subject; a finance application that keeps its own password table is
 * a breach waiting for a news cycle.
 *
 * For now it trusts the address, which is fine for development and must not
 * ship: the guard is `NODE_ENV`, and the replacement is an OIDC code exchange
 * that lands in this same shape.
 */
@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  @Post('sign-in')
  // 200, not Nest's default 201: signing in does not create a resource at a
  // URL, and a client checking for 201 would be checking the wrong thing.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange an email address for a session token',
    description:
      'Development stand-in for an OIDC code exchange. Creates the user if the address is unknown, in which case the session has no workspaces and the client must run onboarding.',
  })
  async signIn(@ValidBody(SignInDto) body: SignInDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    const email = body.email.trim().toLowerCase();
    const nameFromEmail = (email.split('@')[0] ?? 'You')
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const user = await upsertUserByEmail(email, nameFromEmail);
    // Read the memberships with a user context and no tenant context — the one
    // query that is legitimately answered in that state (migration 0012).
    const workspaces = await listWorkspacesFor(getDb(), user.userId);

    return { token: issueSession(user.userId), user, workspaces };
  }

  @Get('demo-accounts')
  @ApiOperation({
    summary: 'The seeded demo accounts',
    description:
      'So a presenter can switch person without typing an address. Returns nothing in production — a list of real sign-in addresses is not something to serve publicly.',
  })
  async demoAccounts(): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    if (isProduction()) return [];
    return listDemoAccounts();
  }

  @Get('session')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'The signed-in user and the workspaces they belong to' })
  async session(@CurrentUser() user: AuthUser): Promise<{
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    return { user, workspaces: await listWorkspacesFor(getDb(), user.userId) };
  }
}
