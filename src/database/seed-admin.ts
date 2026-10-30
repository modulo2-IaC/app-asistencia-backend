import 'dotenv/config';
import { hash } from 'bcryptjs';
import dataSource from './data-source';
import { User, UserRole } from '../modules/users/entities/user.entity';

async function seedAdmin(): Promise<void> {
  const registrationNo = process.env.ADMIN_REGISTRATION_NO?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || null;

  if (!registrationNo || !/^\d{7,12}$/.test(registrationNo)) {
    throw new Error(
      'ADMIN_REGISTRATION_NO must contain between 7 and 12 digits',
    );
  }
  if (
    !password ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'ADMIN_PASSWORD must contain at least 8 characters and at most 72 UTF-8 bytes',
    );
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    const existingUser = await users.findOne({ where: { registrationNo } });

    if (existingUser) {
      if (existingUser.role !== UserRole.ADMIN) {
        throw new Error(
          `Registration number ${registrationNo} already belongs to a non-admin user; no changes made.`,
        );
      }

      existingUser.passwordHash = await hash(password, 12);
      if (fullName) existingUser.fullName = fullName;
      await users.save(existingUser);
      console.info(
        `Admin ${registrationNo} updated/synchronized successfully.`,
      );
      return;
    }

    const user = users.create({
      role: UserRole.ADMIN,
      registrationNo,
      passwordHash: await hash(password, 12),
      fullName,
      degreeProgram: null,
    });
    await users.save(user);
    console.info(
      `Initial admin created for registration number ${registrationNo}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void seedAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown error while seeding admin';
  console.error(message);
  process.exitCode = 1;
});
